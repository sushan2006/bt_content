import type { PlatformAdapter, SyncContext } from './types.js';
import { fetchInsights, graph, graphPaged, toNumber } from './meta.js';
import { metaToken } from './tokens.js';
import { daysAgo, isoDate } from '../sync/writer.js';

/**
 * Facebook Page via Graph API.
 * 2026 notes: page_impressions_unique / post_impressions_unique and many *_unique metrics were deprecated
 * on 2026-06-15; replacements are page_total_media_view_unique / post_total_media_view_unique and *_media_view.
 * The adapter falls back metric-by-metric so a deprecation marks one metric not_supported instead of failing the sync.
 */
const POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_reactions_by_type_total', 'post_clicks'];
const POST_MAP: Record<string, string> = {
  post_media_view: 'views', post_total_media_view_unique: 'reach', post_reactions_by_type_total: 'reactions', post_clicks: 'clicks',
};
const VIDEO_METRICS = ['total_video_views', 'total_video_complete_views', 'total_video_avg_time_watched', 'total_video_view_total_time', 'total_video_retention_graph'];
const REEL_METRICS = ['blue_reels_play_count', 'post_video_avg_time_watched', 'post_video_view_time', 'post_video_retention_graph'];
const VIDEO_MAP: Record<string, { key: string; scale?: number }> = {
  total_video_views: { key: 'video_views' },
  total_video_complete_views: { key: 'complete_views' },
  total_video_avg_time_watched: { key: 'avg_watch_time_sec', scale: 1 / 1000 },
  total_video_view_total_time: { key: 'total_watch_time_sec', scale: 1 / 1000 },
  blue_reels_play_count: { key: 'reel_plays' },
  post_video_avg_time_watched: { key: 'avg_watch_time_sec', scale: 1 / 1000 },
  post_video_view_time: { key: 'total_watch_time_sec', scale: 1 / 1000 },
};
const PAGE_METRICS = ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_daily_follows_unique', 'page_total_actions'];
const PAGE_MAP: Record<string, string> = {
  page_media_view: 'views', page_total_media_view_unique: 'reach', page_post_engagements: 'post_engagements',
  page_daily_follows_unique: 'new_follows', page_total_actions: 'page_actions',
};

/** Facebook retention graph: {"0":1,"1":0.93,...,"40":0.1} -> 41 buckets across the video length. */
export function parseFbRetention(raw: any): { r: number; v: number }[] {
  if (!raw || typeof raw !== 'object') return [];
  const keys = Object.keys(raw).map(Number).filter((k) => Number.isFinite(k));
  if (!keys.length) return [];
  const maxK = Math.max(...keys);
  return keys.sort((a, b) => a - b).map((k) => {
    let v = Number(raw[String(k)]);
    if (v > 1.5) v = v / 100; // some responses are percentages
    return { r: maxK ? k / maxK : 0, v };
  });
}

export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',
  async sync(ctx: SyncContext) {
    const { account, writer } = ctx;
    const token = await metaToken(account.id);
    const pageId = account.external_account_id;
    const today = isoDate(new Date());

    const page = await graph<any>(pageId, { fields: 'name,followers_count,fan_count' }, token);
    await writer.accountMetric('followers', toNumber(page.followers_count ?? page.fan_count), { period: 'lifetime', period_end: today });

    // ---- Page daily insights (one call per metric fallback inside fetchInsights is per-batch; time series need raw rows)
    const since = isoDate(daysAgo(Math.min(ctx.backfillDays, 90)));
    for (const m of PAGE_METRICS) {
      try {
        const res = await graph<any>(`${pageId}/insights`, { metric: m, period: 'day', since, until: today }, token);
        for (const v of res.data?.[0]?.values ?? []) {
          // end_time is the end of the day in Pacific time; the value belongs to the previous day
          const d = new Date(v.end_time); d.setUTCDate(d.getUTCDate() - 1);
          const day = isoDate(d);
          await writer.accountMetric(PAGE_MAP[m], toNumber(v.value), { period: 'day', period_start: day, period_end: day });
        }
      } catch (e) {
        ctx.softErrors++;
        await writer.accountMetric(PAGE_MAP[m], null, { period: 'day', period_start: today, period_end: today, availability: 'not_supported' });
        await ctx.log('warn', `FB page metric ${m} failed: ${(e as Error).message}`);
      }
    }
    // Page fans by country (may be unavailable for small pages)
    try {
      const res = await graph<any>(`${pageId}/insights`, { metric: 'page_fans_country', period: 'lifetime' }, token);
      const v = res.data?.[0]?.values?.at(-1)?.value ?? {};
      for (const [country, n] of Object.entries(v)) await writer.audience('country', country, toNumber(n));
    } catch (e) {
      await ctx.log('info', `FB page_fans_country unavailable: ${(e as Error).message}`);
    }

    // ---- Posts
    const posts = await graphPaged<any>(`${pageId}/published_posts`, {
      fields: 'id,message,created_time,permalink_url,full_picture,is_published,attachments{media_type,type,target{id},media{source}},shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)',
      limit: 50,
    }, token, ctx.maxMedia);
    const videoIdsSeen = new Set<string>();

    for (const p of posts) {
      const att = p.attachments?.data?.[0];
      const isVideo = att && /video|reel/i.test(`${att.media_type} ${att.type}`);
      const videoId = isVideo ? att?.target?.id ?? null : null;
      let duration: number | null = null;
      if (videoId) {
        videoIdsSeen.add(videoId);
        try { duration = toNumber((await graph<any>(videoId, { fields: 'length' }, token)).length); } catch { /* ignore */ }
      }
      const pubId = await writer.upsertPublication({
        platform_post_id: p.id,
        platform_video_id: videoId,
        format: isVideo ? (/reel/i.test(att.type ?? '') ? 'reel' : 'video') : att?.media_type?.toLowerCase() ?? 'status',
        caption: p.message ?? null,
        permalink: p.permalink_url,
        thumbnail_url: p.full_picture ?? null,
        published_at: p.created_time,
        duration_sec: duration,
        raw: { attachment_type: att?.type, media_type: att?.media_type },
      });
      await writer.pubMetric(pubId, 'comments', toNumber(p.comments?.summary?.total_count), p.comments ? 'available' : 'unavailable');
      await writer.pubMetric(pubId, 'shares', toNumber(p.shares?.count ?? 0), 'available'); // shares field absent == 0 shares
      const ins = await fetchInsights(p.id, 'insights', POST_METRICS, { period: 'lifetime' }, token);
      for (const [m, r] of ins) await writer.pubMetric(pubId, POST_MAP[m], r.value, r.availability);
      if (videoId) await syncVideo(ctx, token, pubId, videoId, duration, /reel/i.test(att.type ?? ''));
    }

    // ---- Reels that are not surfaced through published_posts
    try {
      const reels = await graphPaged<any>(`${pageId}/video_reels`, { fields: 'id,description,created_time,permalink_url,length,thumbnails{uri}', limit: 50 }, token, ctx.maxMedia);
      for (const r of reels) {
        if (videoIdsSeen.has(r.id)) continue;
        const pubId = await writer.upsertPublication({
          platform_post_id: `reel:${r.id}`, platform_video_id: r.id, format: 'reel', caption: r.description ?? null,
          permalink: r.permalink_url ? `https://www.facebook.com${r.permalink_url}` : null,
          thumbnail_url: r.thumbnails?.data?.[0]?.uri ?? null, published_at: r.created_time, duration_sec: toNumber(r.length),
        });
        await syncVideo(ctx, token, pubId, r.id, toNumber(r.length), true);
      }
    } catch (e) {
      await ctx.log('info', `FB video_reels unavailable: ${(e as Error).message}`);
    }
    await ctx.log('info', `Facebook sync: ${posts.length} posts`);
  },
};

async function syncVideo(ctx: SyncContext, token: string, pubId: string, videoId: string, duration: number | null, isReel: boolean) {
  const metrics = isReel ? REEL_METRICS : VIDEO_METRICS;
  const res = await fetchInsights(videoId, 'video_insights', metrics, { period: 'lifetime' }, token);
  for (const [m, r] of res) {
    if (m.endsWith('retention_graph')) {
      const pts = parseFbRetention(r.raw);
      if (pts.length) await ctx.writer.retention(pubId, m, pts, duration);
      else await ctx.writer.pubMetric(pubId, 'retention_curve', null, r.availability === 'available' ? 'unavailable' : r.availability);
      continue;
    }
    const map = VIDEO_MAP[m];
    if (!map) continue;
    await ctx.writer.pubMetric(pubId, map.key, r.value === null ? null : r.value * (map.scale ?? 1), r.availability);
  }
}
