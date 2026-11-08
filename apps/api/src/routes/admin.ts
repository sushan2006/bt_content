import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { authenticate, hashPassword, invalidateUser, requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { analyzerHealth } from '../services/videoAnalysis.js';

export async function adminRoutes(app: FastifyInstance) {
  // ---------- Users
  app.get('/api/users', { preHandler: requirePermission('users.manage') }, async () =>
    q(`SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at, r.code AS role FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at`));
  app.get('/api/roles', { preHandler: authenticate }, async () =>
    q(`SELECT r.*, coalesce(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id GROUP BY r.id ORDER BY r.id`));
  app.post('/api/users', { preHandler: requirePermission('users.manage') }, async (req, reply) => {
    const b = z.object({ email: z.string().email(), full_name: z.string().min(1), password: z.string().min(10), role: z.string() }).parse(req.body);
    const role = await one<any>('SELECT id FROM roles WHERE code=$1', [b.role]);
    if (!role) return reply.code(400).send({ error: 'Unknown role' });
    const u = await one<any>(`INSERT INTO users (email, full_name, password_hash, role_id) VALUES (lower($1),$2,$3,$4) RETURNING id, email`, [b.email, b.full_name, await hashPassword(b.password), role.id]);
    await audit(req.user_!.id, 'user.create', 'user', u.id, { email: b.email, role: b.role }, req.ip);
    return u;
  });
  app.patch('/api/users/:id', { preHandler: requirePermission('users.manage') }, async (req, reply) => {
    const { id } = req.params as any;
    const b = z.object({ role: z.string().optional(), is_active: z.boolean().optional(), full_name: z.string().optional(), password: z.string().min(10).optional() }).parse(req.body);
    if (id === req.user_!.id && (b.is_active === false || (b.role && b.role !== 'admin'))) return reply.code(400).send({ error: 'You cannot demote or deactivate yourself' });
    const roleId = b.role ? (await one<any>('SELECT id FROM roles WHERE code=$1', [b.role]))?.id : null;
    await q(`UPDATE users SET role_id=coalesce($2,role_id), is_active=coalesce($3,is_active), full_name=coalesce($4,full_name), password_hash=coalesce($5,password_hash), updated_at=now() WHERE id=$1`,
      [id, roleId, b.is_active ?? null, b.full_name ?? null, b.password ? await hashPassword(b.password) : null]);
    invalidateUser(id);
    await audit(req.user_!.id, 'user.update', 'user', id, { ...b, password: b.password ? '***' : undefined }, req.ip);
    return { ok: true };
  });

  // ---------- Settings & segment templates
  app.get('/api/settings', { preHandler: authenticate }, async () => {
    const rows = await q<any>('SELECT key, value FROM app_settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
  app.put('/api/settings/:key', { preHandler: requirePermission('settings.manage') }, async (req) => {
    const { key } = req.params as any;
    await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(req.body)]);
    await audit(req.user_!.id, 'settings.update', 'setting', key, req.body);
    return { ok: true };
  });
  app.get('/api/segment-templates', { preHandler: authenticate }, async () => q('SELECT * FROM segment_templates ORDER BY id'));
  app.put('/api/segment-templates/:id', { preHandler: requirePermission('settings.manage') }, async (req) => {
    const segSchema = z.array(z.object({ code: z.string(), label: z.string(), start: z.union([z.number(), z.string()]), end: z.union([z.number(), z.string()]) })).min(1);
    const segs = segSchema.parse((req.body as any).segments);
    await q('UPDATE segment_templates SET segments=$2 WHERE id=$1', [(req.params as any).id, JSON.stringify(segs)]);
    await audit(req.user_!.id, 'settings.segments', 'segment_template', (req.params as any).id, segs);
    return { ok: true };
  });

  app.get('/api/audit', { preHandler: requirePermission('audit.view') }, async () =>
    q(`SELECT a.*, u.full_name, u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500`));

  app.get('/api/system/health', { preHandler: authenticate }, async () => ({
    api: 'ok', db: (await one('SELECT 1 AS ok'))?.ok === 1, analyzer: await analyzerHealth(),
    redis: env.REDIS_URL ? 'configured' : 'not configured (in-process scheduler)',
  }));

}
