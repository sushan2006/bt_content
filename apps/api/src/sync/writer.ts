import { one, q } from '../db/pool.js';

export type Availability = 'available' | 'unavailable' | 'not_supported' | 'permission_missing' | 'error';

let defCache: Map<string, number> | null = null;
async function defId(platform: string, scope: 'publication' | 'account', key: string): Promise<number | null> {
  if (!defCache) {
    defCache = new Map();
    const rows = await q<any>('SELECT id, platform_code, scope, metric_key FROM metric_definitions WHERE deprecated_at IS NULL');
    for (const r of rows) defCache.set(`${r.platform_code}|${r.scope}|${r.metric_key}`, r.id);
  }
  return defCache.get(`${platform}|${scope}|${key}`) ?? null;
}

export interface PublicationInput {
  platform_post_id: string;
  platform_video_id?: string | null;
  format?: string | null;
  title?: string | null;
  caption?: string | null;
  permalink?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  published_at?: string | null;
  is_paid?: boolean | null;
  raw?: unknown;
}

const extractHashtags = (s?: string | null) =>
  Array.from(new Set((s ?? '').match(/#[\p{L}\p{N}_]+/gu)?.map((h) => h.toLowerCase()) ?? []));

/** Per-sync writer bound to one account + job. All writes are append/insert-or-ignore: history is never overwritten. */
export class SyncWriter {
  metricsWritten = 0;
  itemsProcessed = 0;
  constructor(
    public accountId: string,
    public platform: string,
    public jobId: string | null,
  ) {}

  async upsertPublication(p: PublicationInput): Promise<string> {
    const row = await one<{ id: string }>(
      `INSERT INTO platform_publications
         (social_account_id, platform_code, platform_post_id, platform_video_id, format, title, caption, hashtags,
          permalink, thumbnail_url, duration_sec, published_at, is_paid, raw, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (platform_code, platform_post_id) DO UPDATE SET
         platform_video_id = coalesce(EXCLUDED.platform_video_id, platform_publications.platform_video_id),
         format = coalesce(EXCLUDED.format, platform_publications.format),
         title = coalesce(EXCLUDED.title, platform_publications.title),
         caption = coalesce(EXCLUDED.caption, platform_publications.caption),
         hashtags = EXCLUDED.hashtags,
         permalink = coalesce(EXCLUDED.permalink, platform_publications.permalink),
         thumbnail_url = coalesce(EXCLUDED.thumbnail_url, platform_publications.thumbnail_url),
         duration_sec = coalesce(EXCLUDED.duration_sec, platform_publications.duration_sec),
         published_at = coalesce(EXCLUDED.published_at, platform_publications.published_at),
         is_paid = coalesce(EXCLUDED.is_paid, platform_publications.is_paid),
         raw = EXCLUDED.raw,
         last_synced_at = now()
       RETURNING id`,
      [this.accountId, this.platform, p.platform_post_id, p.platform_video_id ?? null, p.format ?? null, p.title ?? null,
       p.caption ?? null, extractHashtags(`${p.title ?? ''} ${p.caption ?? ''}`), p.permalink ?? null, p.thumbnail_url ?? null,
       p.duration_sec ?? null, p.published_at ?? null, p.is_paid ?? null, JSON.stringify(p.raw ?? {})],
    );
    this.itemsProcessed++;
    return row!.id;
  }

  /** Write one observation of a publication metric. value=null requires availability != 'available'. */
  async pubMetric(
    publicationId: string,
    metricKey: string,
    value: number | null,
    availability: Availability = value === null ? 'unavailable' : 'available',
    opts: { period?: string; period_start?: string | null; period_end?: string | null; distribution?: string; raw?: unknown } = {},
  ) {
    if (value !== null && !Number.isFinite(value)) { value = null; availability = 'error'; }
    const id = await defId(this.platform, 'publication', metricKey);
    const ins = await one<{ id: number }>(
      `INSERT INTO metric_snapshots (publication_id, social_account_id, platform_code, metric_key, metric_definition_id, value,
          availability, period, period_start, period_end, distribution, sync_job_id, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT DO NOTHING RETURNING id`,
      [publicationId, this.accountId, this.platform, metricKey, id, value, availability, opts.period ?? 'lifetime',
       opts.period_start ?? null, opts.period_end ?? null, opts.distribution ?? 'all', this.jobId,
       opts.raw ? JSON.stringify(opts.raw) : null],
    );
    if ((opts.period ?? 'lifetime') === 'lifetime' && (opts.distribution ?? 'all') === 'all') {
      // Latest-value cache. Never replace an available value with an unavailable one from a flaky call.
      await q(
        `INSERT INTO publication_metrics (publication_id, metric_key, value, availability, snapshot_id, collected_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (publication_id, metric_key) DO UPDATE SET
           value = CASE WHEN EXCLUDED.availability='available' OR publication_metrics.availability<>'available'
                        THEN EXCLUDED.value ELSE publication_metrics.value END,
           availability = CASE WHEN EXCLUDED.availability='available' OR publication_metrics.availability<>'available'
                        THEN EXCLUDED.availability ELSE publication_metrics.availability END,
           snapshot_id = coalesce(EXCLUDED.snapshot_id, publication_metrics.snapshot_id),
           collected_at = CASE WHEN EXCLUDED.availability='available' OR publication_metrics.availability<>'available'
                        THEN now() ELSE publication_metrics.collected_at END`,
        [publicationId, metricKey, value, availability, ins?.id ?? null],
      );
    }
    if (ins) this.metricsWritten++;
  }

  async accountMetric(
    metricKey: string,
    value: number | null,
    opts: { period?: string; period_start?: string | null; period_end?: string | null; availability?: Availability; distribution?: string } = {},
  ) {
    const availability = opts.availability ?? (value === null ? 'unavailable' : 'available');
    const id = await defId(this.platform, 'account', metricKey);
    // Daily account metrics are restated by platforms for a few days: keep each observation (collected_hour differs).
    const ins = await one(
      `INSERT INTO metric_snapshots (publication_id, social_account_id, platform_code, metric_key, metric_definition_id, value,
          availability, period, period_start, period_end, distribution, sync_job_id)
       VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
      [this.accountId, this.platform, metricKey, id, value, availability, opts.period ?? 'day', opts.period_start ?? null,
       opts.period_end ?? null, opts.distribution ?? 'all', this.jobId],
    );
    if (ins) this.metricsWritten++;
  }

  /** points: [{r: ratio-of-duration 0..1, v: share of audience watching}] */
  async retention(publicationId: string, sourceMetric: string, points: { r: number; v: number }[], durationSec: number | null, rel?: { r: number; v: number }[]) {
    if (!points.length) return;
    const pts = points
      .filter((p) => Number.isFinite(p.r) && Number.isFinite(p.v))
      .sort((a, b) => a.r - b.r)
      .map((p) => ({ r: round(p.r, 4), t: durationSec ? round(p.r * durationSec, 2) : null, v: round(p.v, 5) }));
    await q(
      `INSERT INTO retention_curves (publication_id, source_metric, points, rel_points, duration_sec)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (publication_id, source_metric, collected_date) DO UPDATE
         SET points=EXCLUDED.points, rel_points=EXCLUDED.rel_points, duration_sec=EXCLUDED.duration_sec, collected_at=now()`,
      [publicationId, sourceMetric, JSON.stringify(pts), rel ? JSON.stringify(rel) : null, durationSec],
    );
    this.metricsWritten++;
  }

  async audience(dimension: string, bucket: string, value: number | null, opts: { publicationId?: string | null; unit?: string; period_start?: string; period_end?: string } = {}) {
    await q(
      `INSERT INTO audience_insights (social_account_id, publication_id, dimension, bucket, value, value_unit, period_start, period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (social_account_id, coalesce(publication_id,'00000000-0000-0000-0000-000000000000'::uuid), dimension, bucket, collected_date)
       DO UPDATE SET value=EXCLUDED.value, collected_at=now()`,
      [this.accountId, opts.publicationId ?? null, dimension, bucket, value, opts.unit ?? 'count', opts.period_start ?? null, opts.period_end ?? null],
    );
  }
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };
