import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { authenticate, hashPassword, invalidateUser, requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { analyzerHealth } from '../services/videoAnalysis.js';

const goodZone = (z: string) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
/** Checks for the analytics settings; unknown keys in the saved object are kept as they are. */
const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  analysis: z.object({
    min_sample_preliminary: z.number().int().min(2).max(100), min_sample_moderate: z.number().int().min(2).max(100), min_sample_strong: z.number().int().min(2).max(100),
    alpha: z.number().min(0.001).max(0.2), bootstrap_iterations: z.number().int().min(200).max(10000),
  }).passthrough().refine((v) => v.min_sample_preliminary <= v.min_sample_moderate && v.min_sample_moderate <= v.min_sample_strong, 'The sample sizes must go up: preliminary <= moderate <= strong'),
  sync: z.object({
    interval_minutes: z.number().int().min(60).max(10080), backfill_days: z.number().int().min(7).max(365),
    max_media_per_sync: z.number().int().min(50).max(2000), stale_after_hours: z.number().int().min(1).max(336),
  }).passthrough(),
  company: z.object({
    name: z.string().trim().min(1).max(100), website: z.string().trim().max(200).optional(),
    intro_keywords: z.array(z.string().trim().min(1).max(60)).max(40).optional(), timezone: z.string().max(60).refine(goodZone, 'Unknown timezone').optional(),
  }).passthrough(),
};

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
    const schema = SETTING_SCHEMAS[key];
    if (schema) req.body = schema.parse(req.body);
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

  // The audit log (list, summary, filters, CSV) is in routes/audit.ts

  app.get('/api/system/health', { preHandler: authenticate }, async () => ({
    api: 'ok', db: (await one('SELECT 1 AS ok'))?.ok === 1, analyzer: await analyzerHealth(),
    redis: env.REDIS_URL ? 'configured' : 'not configured (in-process scheduler)',
  }));

}
