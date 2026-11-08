import { q } from '../db/pool.js';

export async function audit(
  userId: string | null | undefined,
  action: string,
  entityType?: string,
  entityId?: string | null,
  details?: unknown,
  ip?: string,
) {
  await q(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId ?? null, action, entityType ?? null, entityId ?? null, details ? JSON.stringify(details) : null, ip ?? null],
  );
}

export async function integrationLog(
  accountId: string | null,
  jobId: string | null,
  level: 'info' | 'warn' | 'error',
  message: string,
  extra: { endpoint?: string; http_status?: number; details?: unknown } = {},
) {
  await q(
    `INSERT INTO integration_logs (social_account_id, sync_job_id, level, endpoint, http_status, message, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [accountId, jobId, level, extra.endpoint ?? null, extra.http_status ?? null, message.slice(0, 2000),
     extra.details ? JSON.stringify(extra.details) : null],
  );
}
