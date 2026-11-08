import { one, q } from '../db/pool.js';
import { adapters } from '../integrations/registry.js';
import { SyncWriter } from './writer.js';
import { integrationLog } from '../lib/audit.js';
import { TokenExpiredError } from '../integrations/tokens.js';
import { ApiError } from '../lib/http.js';
import type { SocialAccountRow, SyncContext } from '../integrations/types.js';

const running = new Set<string>();

export async function getSyncSettings() {
  const s = await one<any>(`SELECT value FROM app_settings WHERE key='sync'`);
  return { interval_minutes: 360, backfill_days: 90, max_media_per_sync: 500, stale_after_hours: 26, ...(s?.value ?? {}) };
}

/** Run one sync for one account. Safe against concurrent runs for the same account. */
export async function syncAccount(accountId: string, triggeredBy = 'schedule', jobType = 'incremental'): Promise<{ jobId: string | null; status: string }> {
  if (running.has(accountId)) return { jobId: null, status: 'already_running' };
  const account = await one<SocialAccountRow & { status: string }>('SELECT * FROM social_accounts WHERE id=$1', [accountId]);
  if (!account) throw new Error('Account not found');
  if (account.data_origin === 'demo') return { jobId: null, status: 'demo_account_not_synced' };
  const adapter = adapters[account.platform_code];
  if (!adapter) throw new Error(`No adapter for platform ${account.platform_code}`);

  running.add(accountId);
  const job = (await one<{ id: string }>(
    `INSERT INTO sync_jobs (social_account_id, job_type, status, started_at, triggered_by) VALUES ($1,$2,'running',now(),$3) RETURNING id`,
    [accountId, jobType, triggeredBy]))!;
  const writer = new SyncWriter(accountId, account.platform_code, job.id);
  const settings = await getSyncSettings();
  const ctx: SyncContext = {
    account, writer, jobId: job.id,
    backfillDays: account.last_synced_at && jobType !== 'backfill' ? 14 : settings.backfill_days,
    maxMedia: settings.max_media_per_sync,
    softErrors: 0,
    log: (level, message, extra) => integrationLog(accountId, job.id, level, message, extra),
  };
  let status = 'succeeded', error: string | null = null;
  try {
    await adapter.sync(ctx);
    if (ctx.softErrors > 0) status = 'partial';
  } catch (e) {
    status = 'failed';
    error = (e as Error).message;
    await integrationLog(accountId, job.id, 'error', `Sync failed: ${error}`, {
      endpoint: e instanceof ApiError ? e.url : undefined, http_status: e instanceof ApiError ? e.status : undefined,
      details: e instanceof ApiError ? e.body : undefined });
  } finally {
    running.delete(accountId);
  }
  await q(
    `UPDATE sync_jobs SET status=$2, finished_at=now(), items_processed=$3, metrics_written=$4, error_count=$5, error_summary=$6 WHERE id=$1`,
    [job.id, status, writer.itemsProcessed, writer.metricsWritten, ctx.softErrors + (status === 'failed' ? 1 : 0), error],
  );
  const accountStatus = status === 'failed' ? (error && /token|expired|oauth|invalid_grant|#190/i.test(error) ? 'token_expired' : 'error') : 'connected';
  await q(
    `UPDATE social_accounts SET last_sync_status=$2, last_error=$3,
        last_synced_at = CASE WHEN $2 <> 'failed' THEN now() ELSE last_synced_at END,
        status = CASE WHEN status='token_expired' AND $2='failed' THEN status ELSE $4 END, updated_at=now()
      WHERE id=$1`,
    [accountId, status, error, accountStatus],
  );
  void TokenExpiredError;
  return { jobId: job.id, status };
}

export async function syncAll(triggeredBy = 'schedule') {
  const accounts = await q<{ id: string }>(`SELECT id FROM social_accounts WHERE data_origin='live' AND status <> 'disconnected'`);
  const results = [];
  for (const a of accounts) results.push(await syncAccount(a.id, triggeredBy).catch((e) => ({ jobId: null, status: `error: ${e.message}` })));
  return results;
}
