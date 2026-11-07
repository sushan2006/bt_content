import { Queue, Worker } from 'bullmq';
import { env } from '../config.js';
import { getSyncSettings, syncAccount, syncAll } from '../sync/syncService.js';
import { runVideoAnalysis } from '../services/videoAnalysis.js';
import { runIntelligence } from '../intelligence/engine.js';

/**
 * Background processing.
 *  - With REDIS_URL: BullMQ queue "cip" + repeatable scheduled sync (survives restarts, retries with backoff).
 *  - Without REDIS_URL: in-process scheduler (fine for a single local machine).
 */
type JobName = 'sync-all' | 'sync-account' | 'analyze-video' | 'run-intelligence';
let queue: Queue | null = null;
let fallbackTimer: NodeJS.Timeout | null = null;

async function handle(name: JobName, data: any) {
  switch (name) {
    case 'sync-all': return syncAll(data?.triggeredBy ?? 'schedule');
    case 'sync-account': return syncAccount(data.accountId, data.triggeredBy ?? 'manual', data.jobType ?? 'incremental');
    case 'analyze-video': return runVideoAnalysis(data.contentItemId, data.assetId, data.analysisId);
    case 'run-intelligence': return runIntelligence(data ?? {});
  }
}

export async function enqueue(name: JobName, data: any = {}) {
  if (queue) {
    await queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 200, removeOnFail: 500 });
    return { queued: true };
  }
  // No Redis: run in background without blocking the request
  setImmediate(() => handle(name, data).catch((e) => console.error(`[job ${name}]`, e)));
  return { queued: true, inProcess: true };
}

let studioTimer: NodeJS.Timeout | null = null;

export async function startJobs(log: (m: string) => void) {
  const { interval_minutes } = await getSyncSettings();
  // Content Studio: email replies, suggestion deadlines, Drive intake and scheduled publishing (every minute)
  const { tick } = await import('../studio/pipeline.js');
  studioTimer = setInterval(() => tick().catch((e) => console.error('[studio tick]', e)), 60_000);
  setTimeout(() => tick().catch(() => {}), 5_000);
  if (env.REDIS_URL) {
    const url = new URL(env.REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined, maxRetriesPerRequest: null };
    queue = new Queue('cip', { connection });
    await queue.upsertJobScheduler('scheduled-sync', { every: interval_minutes * 60_000 }, { name: 'sync-all', data: { triggeredBy: 'schedule' } });
    new Worker('cip', async (job) => handle(job.name as JobName, job.data), { connection, concurrency: 2 })
      .on('failed', (job, err) => console.error(`[bullmq] ${job?.name} failed: ${err.message}`));
    log(`BullMQ worker started (sync every ${interval_minutes} min)`);
  } else {
    fallbackTimer = setInterval(() => handle('sync-all', { triggeredBy: 'schedule' }).catch(console.error), interval_minutes * 60_000);
    log(`In-process scheduler started (no REDIS_URL). Sync every ${interval_minutes} min`);
  }
}

export async function stopJobs() {
  if (fallbackTimer) clearInterval(fallbackTimer);
  if (studioTimer) clearInterval(studioTimer);
  await queue?.close();
}
