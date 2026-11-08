import type { PlatformAdapter, SyncContext } from './types.js';
import { fetchInsights, graph, graphPaged, insightValue, toNumber } from './meta.js';
import { metaToken } from './tokens.js';
import { daysAgo, isoDate } from '../sync/writer.js';

/**
 * Instagram Graph API (Instagram API with Facebook Login) for professional accounts.
 * Notes (2025-2026):
 *  - impressions / plays / clips_replays_count were removed (Apr 2025). "views" replaces them.
 *  - Missing data is returned as an empty set (not 0): stored as 'unavailable'.
 *  - No per-second retention curve is exposed for Reels: only average & total watch time.
 *  - Watch-time metrics are returned in milliseconds.
 */
const REEL_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];
const FEED_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits', 'follows'];
const MAP: Record<string, { key: string; scale?: number }> = {
  views: { key: 'views' }, reach: { key: 'reach' }, likes: { key: 'likes' }, comments: { key: 'comments' },
  shares: { key: 'shares' }, saved: { key: 'saves' }, total_interactions: { key: 'total_interactions' },
  ig_reels_avg_watch_time: { key: 'avg_watch_time_sec', scale: 1 / 1000 },
  ig_reels_video_view_total_time: { key: 'total_watch_time_sec', scale: 1 / 1000 },
  profile_visits: { key: 'profile_visits' }, follows: { key: 'follows' },
};

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  async sync(ctx: SyncContext) {
    const { account, writer } = ctx;
    const token = await metaToken(account.id);
    const igId = account.external_account_id;

    // ---- Account fields
    const me = await graph<any>(igId, { fields: 'username,name,followers_count,follows_count,media_count,profile_picture_url' }, token);
    const today = isoDate(new Date());
    await writer.accountMetric('followers', toNumber(me.followers_count), { period: 'lifetime', period_end: today });

    // ---- Account insights: daily reach time-series (max 30 days per call)
    const since = Math.floor(daysAgo(Math.min(ctx.backfillDays, 29)).getTime() / 1000);
    const until = Math.floor(Date.now() / 1000);
    try {
      const reach = await graph<any>(`${igId}/insights`, { metric: 'reach', period: 'day', since, until }, token);
      for (const v of reach.data?.[0]?.values ?? []) {
        const d = v.end_time.slice(0, 10);
        await writer.accountMetric('reach', toNumber(v.value), { period: 'day', period_start: d, period_end: d });
      }
    } catch (e) {
      ctx.softErrors++; await ctx.log('warn', `IG account reach failed: ${(e as Error).message}`);
    }
    // total_value metrics for yesterday (one row per sync day keeps history)
    const y0 = Math.floor(daysAgo(1).setUTCHours(0, 0, 0, 0) / 1000), y1 = y0 + 86400;
    const yday = isoDate(new Date(y0 * 1000));
    const tv = await fetchInsights(igId, 'insights', ['views', 'accounts_engaged', 'total_interactions', 'profile_links_taps'],
      { period: 'day', metric_type: 'total_value', since: y0, until: y1 }, token);
    for (const [m, r] of tv) {
      await writer.accountMetric(m, r.value, { period: 'day', period_start: yday, period_end: yday, availability: r.availability });
    }

    // ---- Audience demographics
    for (const breakdown of ['country', 'city', 'age', 'gender']) {
      try {
        const res = await graph<any>(`${igId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown }, token);
        const results = res.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
        for (const r of results) await writer.audience(breakdown, r.dimension_values.join('|'), toNumber(r.value));
      } catch (e) {
        await ctx.log('info', `IG follower_demographics(${breakdown}) unavailable: ${(e as Error).message}`); // needs >=100 followers
      }
    }

    // ---- Media list
    const media = await graphPaged<any>(`${igId}/media`, {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: 50,
    }, token, ctx.maxMedia);

    for (const m of media) {
      const isReel = m.media_product_type === 'REELS';
      const format = isReel ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : m.media_type === 'VIDEO' ? 'feed_video' : 'image';
      const pubId = await writer.upsertPublication({
        platform_post_id: m.id,
        format,
        caption: m.caption ?? null,
        permalink: m.permalink,
        thumbnail_url: m.thumbnail_url ?? (m.media_type === 'IMAGE' ? m.media_url : null),
        published_at: m.timestamp,
        raw: { media_type: m.media_type, media_product_type: m.media_product_type },
      });
      const metrics = isReel ? REEL_METRICS : FEED_METRICS;
      const res = await fetchInsights(m.id, 'insights', metrics, {}, token);
      for (const [pm, r] of res) {
        const map = MAP[pm];
        if (!map) continue;
        const val = r.value === null ? null : r.value * (map.scale ?? 1);
        await writer.pubMetric(pubId, map.key, val, r.availability, { raw: r.error ? { error: r.error } : undefined });
        if (r.availability === 'error') ctx.softErrors++;
      }
      if (!isReel) {
        // Watch time isn't defined for images/carousels
        await writer.pubMetric(pubId, 'avg_watch_time_sec', null, 'not_supported');
      }
      // Retention curve is not exposed by the Instagram API.
      await writer.pubMetric(pubId, 'retention_curve', null, 'not_supported');
    }
    await ctx.log('info', `Instagram sync: ${media.length} media`);
    void insightValue;
  },
};
