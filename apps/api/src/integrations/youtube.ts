import type { PlatformAdapter, SyncContext } from './types.js';
import { googleAccessToken } from './tokens.js';
import { ApiError, request } from '../lib/http.js';
import { daysAgo, isoDate } from '../sync/writer.js';
import { q } from '../db/pool.js';

/**
 * YouTube Data API v3 + YouTube Analytics API v2 + YouTube Reporting API v1.
 *  - Retention: elapsedVideoTimeRatio (100 points) x audienceWatchRatio (can exceed 1 with rewatches)
 *  - Impressions & CTR are NOT in the Analytics API; they come from the Reporting API bulk report
 *    channel_reach_basic_a1 (daily CSV, first files appear ~48h after the job is created).
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.upload', // Phase 2: publishing approved videos
  'openid', 'email',
];

const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

export function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

async function ytReport(token: string, params: Record<string, string>) {
  const u = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  for (const [k, v] of Object.entries({ ids: 'channel==MINE', ...params })) u.searchParams.set(k, v);
  const res = await request<any>(u.toString(), auth(token));
  const cols: string[] = res.columnHeaders.map((c: any) => c.name);
  return (res.rows ?? []).map((row: any[]) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

const VIDEO_METRICS = 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost';

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  async sync(ctx: SyncContext) {
    const { account, writer } = ctx;
    const token = await googleAccessToken(account.id);
    const today = isoDate(new Date());

    // ---- Channel
    const ch = await request<any>('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', auth(token));
    const channel = ch.items?.find((c: any) => c.id === account.external_account_id) ?? ch.items?.[0];
    if (!channel) throw new Error('No YouTube channel found for this Google account');
    const hidden = channel.statistics.hiddenSubscriberCount;
    await writer.accountMetric('followers', hidden ? null : Number(channel.statistics.subscriberCount), {
      period: 'lifetime', period_end: today, availability: hidden ? 'unavailable' : 'available' });

    // Daily channel metrics (Analytics data lags ~2-3 days)
    const start = isoDate(daysAgo(ctx.backfillDays));
    const daily = await ytReport(token, { startDate: start, endDate: today, dimensions: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', sort: 'day' });
    for (const r of daily) {
      await writer.accountMetric('views', r.views, { period: 'day', period_start: r.day, period_end: r.day });
      await writer.accountMetric('total_watch_time_sec', r.estimatedMinutesWatched * 60, { period: 'day', period_start: r.day, period_end: r.day });
      await writer.accountMetric('subscribers_gained', r.subscribersGained, { period: 'day', period_start: r.day, period_end: r.day });
      await writer.accountMetric('subscribers_lost', r.subscribersLost, { period: 'day', period_start: r.day, period_end: r.day });
    }
    // Geography & demographics (channel level)
    try {
      for (const r of await ytReport(token, { startDate: start, endDate: today, dimensions: 'country', metrics: 'views', sort: '-views', maxResults: '50' }))
        await writer.audience('country', r.country, r.views, { period_start: start, period_end: today });
      for (const r of await ytReport(token, { startDate: start, endDate: today, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' }))
        await writer.audience('age_gender', `${r.ageGroup}|${r.gender}`, r.viewerPercentage, { unit: 'percent', period_start: start, period_end: today });
      for (const r of await ytReport(token, { startDate: start, endDate: today, dimensions: 'insightTrafficSourceType', metrics: 'views' }))
        await writer.audience('traffic_source', r.insightTrafficSourceType, r.views, { period_start: start, period_end: today });
    } catch (e) {
      ctx.softErrors++; await ctx.log('warn', `YT audience reports failed: ${(e as Error).message}`);
    }

    // ---- Videos (uploads playlist)
    const uploads = channel.contentDetails.relatedPlaylists.uploads;
    const ids: string[] = [];
    let pageToken = '';
    do {
      const res = await request<any>(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ''}`, auth(token));
      ids.push(...res.items.map((i: any) => i.contentDetails.videoId));
      pageToken = res.nextPageToken ?? '';
    } while (pageToken && ids.length < ctx.maxMedia);

    const pubByVideo = new Map<string, { id: string; duration: number | null; published: string }>();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const res = await request<any>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,status&id=${batch.join(',')}`, auth(token));
      for (const v of res.items) {
        const duration = parseIsoDuration(v.contentDetails.duration);
        const pubId = await writer.upsertPublication({
          platform_post_id: v.id,
          platform_video_id: v.id,
          format: duration !== null && duration <= 180 ? 'short_or_video' : 'video',
          title: v.snippet.title,
          caption: v.snippet.description,
          permalink: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail_url: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.default?.url,
          duration_sec: duration,
          published_at: v.snippet.publishedAt,
          raw: { tags: v.snippet.tags ?? [], privacy: v.status?.privacyStatus, definition: v.contentDetails.definition },
        });
        pubByVideo.set(v.id, { id: pubId, duration, published: v.snippet.publishedAt.slice(0, 10) });
      }
    }

    // ---- Lifetime analytics per video (batched filter)
    const vids = [...pubByVideo.keys()];
    for (let i = 0; i < vids.length; i += 50) {
      const batch = vids.slice(i, i + 50);
      const rows = await ytReport(token, { startDate: '2005-02-14', endDate: today, dimensions: 'video', metrics: VIDEO_METRICS, filters: `video==${batch.join(',')}`, maxResults: '200', sort: '-views' });
      const seen = new Set<string>();
      for (const r of rows) {
        const p = pubByVideo.get(r.video)!; seen.add(r.video);
        await writer.pubMetric(p.id, 'views', r.views);
        await writer.pubMetric(p.id, 'likes', r.likes);
        await writer.pubMetric(p.id, 'comments', r.comments);
        await writer.pubMetric(p.id, 'shares', r.shares);
        await writer.pubMetric(p.id, 'total_watch_time_sec', r.estimatedMinutesWatched * 60);
        await writer.pubMetric(p.id, 'avg_watch_time_sec', r.averageViewDuration);
        await writer.pubMetric(p.id, 'avg_view_percentage', r.averageViewPercentage);
        await writer.pubMetric(p.id, 'subscribers_gained', r.subscribersGained);
        await writer.pubMetric(p.id, 'subscribers_lost', r.subscribersLost);
      }
      for (const v of batch) if (!seen.has(v)) await writer.pubMetric(pubByVideo.get(v)!.id, 'views', null, 'unavailable'); // no analytics yet
    }

    // ---- Retention curves + per-video traffic sources
    for (const [vid, p] of pubByVideo) {
      try {
        const rows = await ytReport(token, { startDate: p.published, endDate: today, dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio,relativeRetentionPerformance', filters: `video==${vid}` });
        if (rows.length) {
          await writer.retention(p.id, 'audienceWatchRatio',
            rows.map((r: any) => ({ r: r.elapsedVideoTimeRatio, v: r.audienceWatchRatio })), p.duration,
            rows.map((r: any) => ({ r: r.elapsedVideoTimeRatio, v: r.relativeRetentionPerformance })));
        } else {
          await writer.pubMetric(p.id, 'retention_curve', null, 'unavailable'); // too few views for YouTube to report
        }
        for (const r of await ytReport(token, { startDate: p.published, endDate: today, dimensions: 'insightTrafficSourceType', metrics: 'views', filters: `video==${vid}` }))
          await writer.audience('traffic_source', r.insightTrafficSourceType, r.views, { publicationId: p.id });
      } catch (e) {
        ctx.softErrors++; await ctx.log('warn', `YT retention ${vid}: ${(e as Error).message}`);
      }
    }

    await syncReachReports(ctx, token, pubByVideo);
    await ctx.log('info', `YouTube sync: ${pubByVideo.size} videos`);
  },
};

/** Impressions + CTR via the YouTube Reporting API (bulk daily CSV reports). */
async function syncReachReports(ctx: SyncContext, token: string, pubByVideo: Map<string, { id: string }>) {
  const base = 'https://youtubereporting.googleapis.com/v1';
  try {
    const jobs = await request<any>(`${base}/jobs`, auth(token));
    let job = jobs.jobs?.find((j: any) => j.reportTypeId === 'channel_reach_basic_a1');
    if (!job) {
      job = await request<any>(`${base}/jobs`, { method: 'POST', body: { reportTypeId: 'channel_reach_basic_a1', name: 'cip-reach' }, ...auth(token) });
      await ctx.log('info', 'Created YouTube Reporting job channel_reach_basic_a1 — impressions/CTR become available after ~48 hours');
    }
    const lastImported: string = ctx.account.metadata?.reach_reports_imported_until ?? '1970-01-01T00:00:00Z';
    const reports = await request<any>(`${base}/jobs/${job.id}/reports?createdAfter=${encodeURIComponent(lastImported)}`, auth(token));
    let newest = lastImported;
    for (const rep of reports.reports ?? []) {
      const csv = await request<string>(rep.downloadUrl, { ...auth(token), raw: true });
      const [header, ...lines] = csv.trim().split(/\r?\n/);
      const cols = header.split(',');
      for (const line of lines) {
        const f = line.split(',');
        const row = Object.fromEntries(cols.map((c, i) => [c, f[i]]));
        const pub = pubByVideo.get(row.video_id);
        if (!pub) continue;
        const day = `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6, 8)}`;
        await ctx.writer.pubMetric(pub.id, 'impressions', Number(row.video_thumbnail_impressions), 'available', { period: 'day', period_start: day, period_end: day });
        await ctx.writer.pubMetric(pub.id, 'ctr', Number(row.video_thumbnail_impressions_ctr), 'available', { period: 'day', period_start: day, period_end: day });
      }
      if (rep.createTime > newest) newest = rep.createTime;
    }
    await q(`UPDATE social_accounts SET metadata = metadata || jsonb_build_object('reach_reports_imported_until', $2::text) WHERE id=$1`, [ctx.account.id, newest]);
    // Lifetime roll-up from daily rows (impressions = sum, CTR = impression-weighted mean)
    for (const pub of pubByVideo.values()) {
      const [agg] = await q<any>(
        `WITH d AS (SELECT DISTINCT ON (period_start, metric_key) metric_key, period_start, value FROM metric_snapshots
                      WHERE publication_id=$1 AND period='day' AND metric_key IN ('impressions','ctr')
                      ORDER BY period_start, metric_key, collected_at DESC),
              i AS (SELECT period_start, value FROM d WHERE metric_key='impressions'),
              c AS (SELECT period_start, value FROM d WHERE metric_key='ctr')
         SELECT sum(i.value) AS imp, sum(i.value*c.value) / nullif(sum(i.value) FILTER (WHERE c.value IS NOT NULL),0) AS ctr
           FROM i LEFT JOIN c USING (period_start)`, [pub.id]);
      if (agg?.imp != null) {
        await ctx.writer.pubMetric(pub.id, 'impressions', Number(agg.imp));
        await ctx.writer.pubMetric(pub.id, 'ctr', agg.ctr == null ? null : Number(agg.ctr));
      } else {
        await ctx.writer.pubMetric(pub.id, 'impressions', null, 'unavailable');
      }
    }
  } catch (e) {
    ctx.softErrors++;
    await ctx.log('warn', `YouTube Reporting API (impressions/CTR) failed: ${(e as Error).message}`,
      { http_status: e instanceof ApiError ? e.status : undefined });
  }
}
