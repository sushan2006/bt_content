import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, q } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { isProd } from '../config.js';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user_?: AuthUser;
  }
}

const cache = new Map<string, { at: number; user: AuthUser | null }>();

export async function loadUser(id: string): Promise<AuthUser | null> {
  const c = cache.get(id);
  if (c && Date.now() - c.at < 30_000) return c.user;
  const row = await one<any>(
    `SELECT u.id, u.email, u.full_name, r.code AS role,
            coalesce(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 AND u.is_active
      GROUP BY u.id, r.code`,
    [id],
  );
  cache.set(id, { at: Date.now(), user: row });
  return row;
}
export const invalidateUser = (id: string) => cache.delete(id);

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await req.jwtVerify<{ sub: string }>({ onlyCookie: false } as any);
    const user = await loadUser(payload.sub);
    if (!user) return reply.code(401).send({ error: 'Account disabled or not found' });
    req.user_ = user;
  } catch {
    return reply.code(401).send({ error: 'Not authenticated' });
  }
}

export function requirePermission(...perms: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await authenticate(req, reply);
    if (reply.sent) return;
    const has = req.user_!.permissions;
    if (!perms.some((p) => has.includes(p))) {
      return reply.code(403).send({ error: `Missing permission: ${perms.join(' or ')}` });
    }
  };
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const u = await one<any>('SELECT id, password_hash, is_active FROM users WHERE lower(email)=lower($1)', [body.email]);
    if (!u || !u.is_active || !(await bcrypt.compare(body.password, u.password_hash))) {
      await audit(null, 'auth.login_failed', 'user', body.email, null, req.ip);
      return reply.code(401).send({ error: 'Invalid email or password' });
    }
    await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    const token = await reply.jwtSign({ sub: u.id }, { expiresIn: '12h' });
    reply.setCookie('cip_token', token, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/', maxAge: 12 * 3600 });
    await audit(u.id, 'auth.login', 'user', u.id, null, req.ip);
    return { user: await loadUser(u.id) };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('cip_token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (req) => ({ user: req.user_ }));

  app.post('/api/auth/change-password', { preHandler: authenticate }, async (req, reply) => {
    const b = z.object({ current: z.string(), next: z.string().min(10) }).parse(req.body);
    const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user_!.id]);
    if (!u || !(await bcrypt.compare(b.current, u.password_hash))) return reply.code(400).send({ error: 'Current password incorrect' });
    await q('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [await hashPassword(b.next), req.user_!.id]);
    await audit(req.user_!.id, 'user.password_change', 'user', req.user_!.id, null, req.ip);
    return { ok: true };
  });
}
