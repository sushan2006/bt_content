import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { env, isProd } from './config.js';
import { authRoutes } from './auth/auth.js';
import { integrationRoutes } from './routes/integrations.js';
import { contentRoutes } from './routes/content.js';
import { analyticsRoutes } from './routes/analytics.js';
import { insightRoutes } from './routes/insights.js';
import { adminRoutes } from './routes/admin.js';
import { auditRoutes } from './routes/audit.js';
import { studioRoutes } from './routes/studio.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: isProd ? 'info' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-webhook-secret"]'],
      transport: isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    bodyLimit: 5 * 1024 * 1024,
  });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: 'cip_token', signed: false } });
  await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', details: err.flatten() });
    const status = (err as any).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 && isProd ? 'Internal error' : err.message });
  });

  app.get('/api/health', async () => ({ ok: true }));
  // Removes any service worker an earlier app registered on this localhost port (it would keep showing its cached pages)
  app.get('/sw.js', async (_req, reply) => reply.header('content-type', 'application/javascript').header('cache-control', 'no-store').send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.registration.unregister();for(const c of await self.clients.matchAll({type:'window'}))c.navigate(c.url);})()));"));
  await app.register(authRoutes);
  await app.register(integrationRoutes);
  await app.register(contentRoutes);
  await app.register(analyticsRoutes);
  await app.register(insightRoutes);
  await app.register(adminRoutes);
  await app.register(auditRoutes);
  await app.register(studioRoutes);

  // Serve the built web app (production / single-port local run)
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
  }
  return app;
}
