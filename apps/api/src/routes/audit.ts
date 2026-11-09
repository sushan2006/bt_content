import type { FastifyInstance } from 'fastify';
import { one, q } from '../db/pool.js';
import { requirePermission } from '../auth/auth.js';
import { AREAS, AREA_OTHER, AREA_SQL, FAILED_SQL, actionLabel, areaOf, areaWhere, csvRow, detailText, entityLabel, isFailed, itemText } from '../lib/auditView.js';
import { audit } from '../lib/audit.js';

const FROM = `FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN roles r ON r.id=u.role_id
  LEFT JOIN production_jobs j ON a.entity_type='production_job' AND a.entity_id = j.id::text`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Builds the WHERE clause from the query string (values are always parameters). */
function filters(f: Record<string, string | undefined>) {
  const where: string[] = []; const p: unknown[] = [];
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  const s = (f.q ?? '').trim().slice(0, 100);
  if (s) { const x = add(`%${s.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(coalesce(u.full_name,'') ILIKE ${x} OR coalesce(u.email,'') ILIKE ${x} OR a.action ILIKE ${x} OR coalesce(a.entity_id,'') ILIKE ${x} OR coalesce(j.code,'') ILIKE ${x} OR coalesce(a.entity_type,'') ILIKE ${x} OR coalesce(a.details::text,'') ILIKE ${x})`); }
  if (f.user && UUID.test(f.user)) where.push(`a.user_id = ${add(f.user)}`);
  if (f.role) where.push(`r.code = ${add(f.role.slice(0, 40))}`);
  if (f.action) where.push(`a.action = ${add(f.action.slice(0, 80))}`);
  if (f.status === 'failed') where.push(FAILED_SQL); else if (f.status === 'success') where.push(`NOT ${FAILED_SQL}`);
  if (f.from && DAY.test(f.from)) where.push(`a.created_at >= ${add(f.from)}::date`);
  if (f.to && DAY.test(f.to)) where.push(`a.created_at < (${add(f.to)}::date + 1)`);
  if (f.area && f.area !== 'all') { const w = areaWhere(f.area); if (w) where.push(w); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', p };
}

const SELECT = `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.details, a.ip, a.user_id,
  u.full_name, u.email, r.code AS role, j.code AS job_code, ${AREA_SQL} AS area ${FROM}`;

function shape(r: any) {
  const area = areaOf(r.action);
  const failedLogin = r.action === 'auth.login_failed';
  return {
    id: r.id, created_at: r.created_at, action: r.action, action_label: actionLabel(r.action),
    user: r.full_name ?? (failedLogin ? r.entity_id : null) ?? 'System', email: r.email ?? (failedLogin ? r.entity_id : null), role: r.role ?? null,
    area: area.key, area_label: area.label, item: itemText(r.entity_type, r.entity_id, r.job_code), item_type: entityLabel(r.entity_type),
    details: detailText(r.details), status: isFailed(r.action) ? 'failed' : 'success', ip: r.ip ?? null,
  };
}

export async function auditRoutes(app: FastifyInstance) {
  const guard = { preHandler: requirePermission('audit.view') };

  app.get('/api/audit/summary', guard, async () => {
    const r = await one<any>(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE a.created_at >= date_trunc('day', now()))::int AS today,
      count(*) FILTER (WHERE r.code = 'admin')::int AS admin,
      count(*) FILTER (WHERE r.code = 'viewer')::int AS viewer,
      count(*) FILTER (WHERE ${FAILED_SQL})::int AS failed ${FROM}`);
    const byArea = await q<any>(`SELECT ${AREA_SQL} AS area, count(*)::int AS n ${FROM} GROUP BY 1`);
    return { ...r, areas: [{ key: 'all', label: 'Overview', n: r?.total ?? 0 }, ...[...AREAS, AREA_OTHER].map((a) => ({ key: a.key, label: a.label, n: byArea.find((x) => x.area === a.key)?.n ?? 0 }))] };
  });

  app.get('/api/audit/filters', guard, async () => {
    const users = await q<any>(`SELECT DISTINCT u.id, u.full_name, u.email FROM audit_logs a JOIN users u ON u.id=a.user_id ORDER BY u.full_name`);
    const actions = await q<any>(`SELECT DISTINCT action FROM audit_logs ORDER BY action`);
    const roles = await q<any>(`SELECT code, name FROM roles ORDER BY id`);
    return {
      users: users.map((u) => ({ id: u.id, name: u.full_name, email: u.email })),
      actions: actions.map((a) => ({ action: a.action, label: actionLabel(a.action) })).sort((a, b) => a.label.localeCompare(b.label)),
      roles,
    };
  });

  app.get('/api/audit', guard, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(parseInt(f.limit ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(f.offset ?? '0', 10) || 0, 0);
    const w = filters(f);
    const total = (await one<any>(`SELECT count(*)::int AS n ${FROM} ${w.sql}`, w.p))?.n ?? 0;
    const rows = await q<any>(`${SELECT} ${w.sql} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`, w.p);
    return { total, limit, offset, rows: rows.map(shape) };
  });

  app.get('/api/audit/export', guard, async (req, reply) => {
    const f = req.query as Record<string, string | undefined>;
    const w = filters(f);
    const rows = (await q<any>(`${SELECT} ${w.sql} ORDER BY a.created_at DESC, a.id DESC LIMIT 20000`, w.p)).map(shape);
    await audit(req.user_?.id, 'data.export', 'audit_logs', null, { rows: rows.length, area: f.area ?? 'all' }, req.ip);
    const head = ['Time', 'User', 'Email', 'Role', 'Area', 'Action', 'Item', 'Details', 'Status', 'IP'];
    const body = rows.map((r) => csvRow([new Date(r.created_at).toISOString(), r.user, r.email, r.role, r.area_label, r.action_label, r.item, r.details, r.status, r.ip]));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="audit-activity-${new Date().toISOString().slice(0, 10)}.csv"`).header('x-content-type-options', 'nosniff');
    return '\uFEFF' + [csvRow(head), ...body].join('\r\n') + '\r\n';
  });
}
