import type { FastifyInstance } from 'fastify';
import { q } from '../db/pool.js';
import { requirePermission } from '../auth/auth.js';
import { originOf } from './content.js';
import { getSyncSettings } from '../sync/syncService.js';
import { loadDataset } from '../intelligence/dataset.js';
import { median, percentileRank } from '../intelligence/stats.js';

/** Metric definitions shown next to combined numbers so nobody mistakes them for one comparable metric. */
const VIEW_DEFINITIONS: Record<string, string> = {
  instagram: 'Instagram "views": times the media was displayed or played (includes repeats).',
  facebook: 'Facebook "media views": times the post/video was viewed (replacement for impressions since 2025-26).',
  youtube: 'YouTube "views": counted watch-page/Shorts views after YouTube\'s validity filtering.',
};

function range(qs: any) {
  const to = qs.to ? new Date(qs.to) : new Date();
  const days = qs.days ? Number(qs.days) : 30;
  const from = qs.from ? new Date(qs.from) : new Date(to.getTime() - days * 864e5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const len = Math.round((to.getTime() - from.getTime()) / 864e5) || 1;
  return { from: iso(from), to: iso(to), prevFrom: iso(new Date(from.getTime() - len * 864e5)), prevTo: iso(new Date(from.getTime() - 864e5)) };
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/overview', { preHandler: requirePermission('analytics.view') }, async (req) => {
    const qs = req.query as any;
    const origin = originOf(req);
    const r = range(qs);
    const settings = await getSyncSettings();
    const pubFilter = `sa.data_origin=$1 AND p.published_at::date BETWEEN $2 AND $3
       AND ($4::text IS NULL OR p.platform_code=$4) AND ($5::int IS NULL OR ci.category_id=$5) AND ($6::uuid IS NULL OR ci.campaign_id=$6)
       AND ($7::text IS NULL OR ($7='paid' AND p.is_paid) OR ($7='organic' AND p.is_paid IS NOT TRUE))`;
    const params = [origin, r.from, r.to, qs.platform || null, qs.category ? Number(qs.category) : null, qs.campaign || null, qs.distribution || null];

    // Content published in range: lifetime totals per platform (with availability counts)
    const content = await q<any>(
      `SELECT p.platform_code,
              count(DISTINCT p.id)::int AS published,
              sum(m.value) FILTER (WHERE m.metric_key='views') AS views, count(m.value) FILTER (WHERE m.metric_key='views')::int AS views_n,
              sum(m.value) FILTER (WHERE m.metric_key='reach') AS reach, count(m.value) FILTER (WHERE m.metric_key='reach')::int AS reach_n,
              sum(m.value) FILTER (WHERE m.metric_key='impressions') AS impressions, count(m.value) FILTER (WHERE m.metric_key='impressions')::int AS impressions_n,
              sum(m.value) FILTER (WHERE m.metric_key IN ('likes','reactions','comments','shares','saves')) AS engagement,
              sum(m.value) FILTER (WHERE m.metric_key='total_watch_time_sec') AS watch_time_sec, count(m.value) FILTER (WHERE m.metric_key='total_watch_time_sec')::int AS watch_n,
              sum(m.value) FILTER (WHERE m.metric_key IN ('shares','saves')) AS shares_saves,
              sum(m.value) FILTER (WHERE m.metric_key IN ('profile_visits','follows','subscribers_gained')) AS profile_actions
         FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id
         LEFT JOIN content_items ci ON ci.id=p.content_item_id
         LEFT JOIN publication_metrics m ON m.publication_id=p.id AND m.availability='available'
        WHERE ${pubFilter} GROUP BY p.platform_code`, params);
    for (const c of content) {
      c.engagement_rate = c.engagement != null && (c.reach || c.views) ? c.engagement / (c.reach || c.views) : null;
      c.engagement_rate_basis = c.reach ? 'reach' : 'views';
      c.views_definition = VIEW_DEFINITIONS[c.platform_code];
    }

    // Followers: latest value in range vs value at range start
    const followers = await q<any>(
      `WITH f AS (SELECT s.social_account_id, s.platform_code, s.value, s.collected_at FROM metric_snapshots s JOIN social_accounts sa ON sa.id=s.social_account_id
                   WHERE sa.data_origin=$1 AND s.metric_key='followers' AND s.publication_id IS NULL AND s.availability='available' AND s.collected_at::date <= $3)
       SELECT platform_code,
              sum(latest) AS followers, sum(latest) - sum(start) AS growth, bool_and(start IS NOT NULL) AS growth_complete
         FROM (SELECT social_account_id, platform_code,
                      (SELECT value FROM f f2 WHERE f2.social_account_id=f.social_account_id ORDER BY collected_at DESC LIMIT 1) AS latest,
                      (SELECT value FROM f f3 WHERE f3.social_account_id=f.social_account_id AND f3.collected_at::date <= $2 ORDER BY collected_at DESC LIMIT 1) AS start
                 FROM f GROUP BY social_account_id, platform_code) x GROUP BY platform_code`, [origin, r.from, r.to]);

    // Account-level daily views/reach in the period (latest restatement per day)
    const accountDaily = await q<any>(
      `SELECT platform_code, metric_key, period_start::text AS day, sum(value) AS value FROM (
         SELECT DISTINCT ON (s.social_account_id, s.metric_key, s.period_start) s.platform_code, s.metric_key, s.period_start, s.value
           FROM metric_snapshots s JOIN social_accounts sa ON sa.id=s.social_account_id
          WHERE sa.data_origin=$1 AND s.publication_id IS NULL AND s.period='day' AND s.availability='available'
            AND s.metric_key IN ('views','reach','subscribers_gained','new_follows') AND s.period_start BETWEEN $2 AND $3
          ORDER BY s.social_account_id, s.metric_key, s.period_start, s.collected_at DESC) d
       GROUP BY 1,2,3 ORDER BY 3`, [origin, r.from, r.to]);

    // Top content and content requiring attention (within-platform percentiles)
    // published in the period (published_at is a Date: compare its ISO day, not its toString())
    const day = (d: any) => new Date(d).toISOString().slice(0, 10);
    const ds = (await loadDataset(origin)).filter((x) => x.published_at && day(x.published_at) >= r.from && day(x.published_at) <= r.to);
    const scored = ds.map((x) => {
      const peers = ds.filter((p) => p.platform === x.platform);
      const pr = (m: string) => { const vals = peers.map((p) => p.derived[m]).filter((v): v is number => v != null); const v = x.derived[m]; return v == null || vals.length < 3 ? null : percentileRank(vals, v); };
      const parts = [pr('avg_view_ratio'), pr('engagement_rate')].filter((v): v is number => v != null);
      return { publication_id: x.publication_id, content_item_id: x.content_item_id, content_code: x.content_code, title: x.title, platform: x.platform,
        views: x.metrics.views ?? null, engagement_rate: x.derived.engagement_rate, avg_view_ratio: x.derived.avg_view_ratio, score: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null };
    }).filter((x) => x.score != null);
    scored.sort((a, b) => b.score! - a.score!);

    // The same video on every platform: content items published on two or more platforms in the period
    const byItem = new Map<string, any>();
    for (const x of ds) {
      if (!x.content_item_id) continue;
      const it = byItem.get(x.content_item_id) ?? { content_item_id: x.content_item_id, content_code: x.content_code, title: x.title, platforms: {} as Record<string, any>, total_views: 0 };
      it.platforms[x.platform] = { publication_id: x.publication_id, views: x.metrics.views ?? null, avg_view_ratio: x.derived.avg_view_ratio ?? null, engagement_rate: x.derived.engagement_rate ?? null };
      it.total_views += x.metrics.views ?? 0;
      byItem.set(x.content_item_id, it);
    }
    const crossPlatform = [...byItem.values()].filter((it) => Object.keys(it.platforms).length >= 2).sort((a, b) => b.total_views - a.total_views).slice(0, 10);

    const accounts = await q<any>(`SELECT id, platform_code, display_name, status, last_synced_at, last_sync_status FROM social_accounts WHERE data_origin=$1 AND status<>'disconnected'`, [origin]);
    const freshness = accounts.map((a) => {
      const ageH = a.last_synced_at ? (Date.now() - new Date(a.last_synced_at).getTime()) / 36e5 : null;
      return { ...a, age_hours: ageH, stale: origin === 'demo' ? false : ageH === null || ageH > settings.stale_after_hours };
    });

    return {
      origin, range: r, content_by_platform: content, followers, account_daily: accountDaily,
      combined: {
        views: content.reduce((s, c) => s + (c.views ?? 0), 0),
        views_note: 'Sum of each platform\'s own "views" metric for content published in the period. Definitions differ by platform and one person can be counted many times — do not read it as unique people.',
        reach_note: 'Reach is not combined across platforms: the same person can be reached on several platforms.',
        engagement: content.reduce((s, c) => s + (c.engagement ?? 0), 0),
        published: content.reduce((s, c) => s + c.published, 0),
        watch_time_sec: content.reduce((s, c) => s + (c.watch_time_sec ?? 0), 0),
        shares_saves: content.reduce((s, c) => s + (c.shares_saves ?? 0), 0),
      },
      top_content: scored.slice(0, 6),
      needs_attention: scored.filter((x) => x.score! <= 0.25).slice(-6).reverse(),
      cross_platform: crossPlatform,
      freshness,
      data_note: origin === 'demo' ? 'DEMO DATA — synthetic records for testing the interface. Not company analytics.' : null,
    };
  });

  app.get('/api/analytics/platform/:code', { preHandler: requirePermission('analytics.view') }, async (req) => {
    const { code } = req.params as any;
    const origin = originOf(req);
    const r = range(req.query);
    const followers = await q(`SELECT s.collected_at::date::text AS day, max(s.value) AS value FROM metric_snapshots s JOIN social_accounts sa ON sa.id=s.social_account_id
                                WHERE sa.data_origin=$1 AND s.platform_code=$2 AND s.metric_key='followers' AND s.publication_id IS NULL AND s.availability='available' GROUP BY 1 ORDER BY 1`, [origin, code]);
    const daily = await q(`SELECT metric_key, period_start::text AS day, sum(value) AS value FROM (
                              SELECT DISTINCT ON (s.social_account_id, s.metric_key, s.period_start) s.metric_key, s.period_start, s.value
                                FROM metric_snapshots s JOIN social_accounts sa ON sa.id=s.social_account_id
                               WHERE sa.data_origin=$1 AND s.platform_code=$2 AND s.publication_id IS NULL AND s.period='day' AND s.availability='available' AND s.period_start BETWEEN $3 AND $4
                               ORDER BY s.social_account_id, s.metric_key, s.period_start, s.collected_at DESC) d GROUP BY 1,2 ORDER BY 2`, [origin, code, r.from, r.to]);
    const frequency = await q(`SELECT date_trunc('week', p.published_at)::date::text AS week, count(*)::int AS posts FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id
                                WHERE sa.data_origin=$1 AND p.platform_code=$2 AND p.published_at IS NOT NULL GROUP BY 1 ORDER BY 1`, [origin, code]);
    const ds = (await loadDataset(origin)).filter((x) => x.platform === code);
    const byWeek = new Map<string, number[]>();
    for (const x of ds) {
      if (!x.published_at || x.derived.engagement_rate == null) continue;
      const d = new Date(x.published_at); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const k = d.toISOString().slice(0, 10);
      byWeek.set(k, [...(byWeek.get(k) ?? []), x.derived.engagement_rate]);
    }
    const engagementTrend = [...byWeek.entries()].sort().map(([week, v]) => ({ week, median_engagement_rate: median(v), posts: v.length }));
    const audience = await q(`SELECT ai.dimension, ai.bucket, sum(ai.value) AS value, max(ai.value_unit) AS unit FROM audience_insights ai JOIN social_accounts sa ON sa.id=ai.social_account_id
                               WHERE sa.data_origin=$1 AND sa.platform_code=$2 AND ai.publication_id IS NULL
                                 AND ai.collected_date = (SELECT max(collected_date) FROM audience_insights a2 WHERE a2.social_account_id=ai.social_account_id AND a2.publication_id IS NULL)
                               GROUP BY 1,2 ORDER BY 1, 3 DESC`, [origin, code]);
    const publications = ds.map((x) => ({ publication_id: x.publication_id, content_item_id: x.content_item_id, content_code: x.content_code, title: x.title, format: x.format, published_at: x.published_at,
      views: x.metrics.views ?? null, reach: x.metrics.reach ?? null, engagement_rate: x.derived.engagement_rate, avg_view_ratio: x.derived.avg_view_ratio, retention_3s: x.derived.retention_3s,
      availability: x.availability })).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    const platform = (await q(`SELECT * FROM platforms WHERE code=$1`, [code]))[0];
    return { platform, range: r, followers, daily, frequency, engagement_trend: engagementTrend, audience, publications, views_definition: VIEW_DEFINITIONS[code] };
  });

}
