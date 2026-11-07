/**
 * Adapter integration tests: real database, mocked platform HTTP responses (shapes taken from the official API docs).
 * Verifies OAuth-token use, pagination, metric mapping, unit conversion, "unavailable" handling, retention parsing,
 * deprecated-metric fallback, snapshots (no overwrite) and sync status bookkeeping.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { one, pool, q } from '../src/db/pool.js';
import { saveToken } from '../src/integrations/tokens.js';
import { syncAccount } from '../src/sync/syncService.js';

type Handler = (url: URL, init?: RequestInit) => any;
const routes: [RegExp, Handler][] = [];
const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await migrate(() => {});
  await q(`TRUNCATE social_accounts, content_items CASCADE`);
  vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    for (const [re, h] of routes) if (re.test(url.toString())) { const r = h(url, init); return r instanceof Response ? r : json(r); }
    return json({ error: { message: `unmocked ${url.pathname}`, code: 100 } }, 400);
  });
});
afterAll(async () => { vi.stubGlobal('fetch', realFetch); await pool.end(); });

async function account(platform: string, ext: string) {
  const a = await one<any>(`INSERT INTO social_accounts (platform_code, external_account_id, display_name) VALUES ($1,$2,$3) RETURNING id`, [platform, ext, `${platform} test`]);
  return a.id as string;
}
const metric = async (pubPost: string, key: string) =>
  one<any>(`SELECT pm.value, pm.availability FROM publication_metrics pm JOIN platform_publications p ON p.id=pm.publication_id WHERE p.platform_post_id=$1 AND pm.metric_key=$2`, [pubPost, key]);

describe('Instagram adapter', () => {
  it('maps metrics, converts ms to seconds, marks missing as unavailable, follows pagination', async () => {
    const id = await account('instagram', '1789');
    await saveToken(id, 'page_access', 'PAGE_TOKEN');
    routes.length = 0;
    routes.push(
      [/\/1789\?/, () => ({ username: 'acme', followers_count: 1200, media_count: 2 })],
      [/\/1789\/insights.*metric=reach&/, () => ({ data: [{ name: 'reach', values: [{ value: 50, end_time: '2026-11-01T07:00:00+0000' }, { value: 70, end_time: '2026-11-02T07:00:00+0000' }] }] })],
      [/\/1789\/insights.*metric_type=total_value&since/, () => ({ data: [{ name: 'views', total_value: { value: 900 } }, { name: 'accounts_engaged', total_value: { value: 40 } }] })],
      [/\/1789\/insights.*follower_demographics/, (u) => ({ data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: [u.searchParams.get('breakdown') === 'country' ? 'IN' : 'x'], value: 10 }] }] } }] })],
      [/\/1789\/media.*after=c2/, () => ({ data: [{ id: 'm2', media_type: 'IMAGE', media_product_type: 'FEED', caption: 'Photo', timestamp: '2026-10-02T10:00:00+0000' }] })],
      [/\/1789\/media\?/, () => ({ data: [{ id: 'm1', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'Reel #Cables', timestamp: '2026-10-01T10:00:00+0000', permalink: 'https://ig/m1' }], paging: { next: 'https://graph.facebook.com/v25.0/1789/media?after=c2&access_token=PAGE_TOKEN' } })],
      [/\/m1\/insights/, () => ({ data: [
        { name: 'views', values: [{ value: 5000 }] }, { name: 'reach', values: [{ value: 3000 }] }, { name: 'likes', values: [{ value: 100 }] },
        { name: 'ig_reels_avg_watch_time', values: [{ value: 7350 }] }, { name: 'saved', values: [{ value: 12 }] } ] })],
      [/\/m2\/insights/, () => ({ data: [{ name: 'views', values: [{ value: 800 }] }] })],
    );
    const res = await syncAccount(id, 'test', 'backfill');
    expect(res.status).toMatch(/succeeded|partial/);
    expect(await metric('m1', 'views')).toEqual({ value: 5000, availability: 'available' });
    expect((await metric('m1', 'avg_watch_time_sec'))!.value).toBeCloseTo(7.35);
    expect(await metric('m1', 'saves')).toEqual({ value: 12, availability: 'available' });
    expect(await metric('m1', 'comments')).toEqual({ value: null, availability: 'unavailable' });   // absent => unavailable, not 0
    expect(await metric('m1', 'retention_curve')).toEqual({ value: null, availability: 'not_supported' });
    expect(await metric('m2', 'avg_watch_time_sec')).toEqual({ value: null, availability: 'not_supported' });
    const pub = await one<any>(`SELECT format, hashtags FROM platform_publications WHERE platform_post_id='m1'`);
    expect(pub).toEqual({ format: 'reel', hashtags: ['#cables'] });
    const reach = await q<any>(`SELECT period_start::text, value FROM metric_snapshots WHERE social_account_id=$1 AND metric_key='reach' AND period='day' ORDER BY 1`, [id]);
    expect(reach.map((r) => r.value)).toEqual([50, 70]);
    const acc = await one<any>('SELECT status, last_sync_status, last_synced_at FROM social_accounts WHERE id=$1', [id]);
    expect(acc.status).toBe('connected'); expect(acc.last_synced_at).not.toBeNull();
  });

  it('second sync in a later hour keeps history (no overwrite)', async () => {
    const id = (await one<any>(`SELECT id FROM social_accounts WHERE external_account_id='1789'`)).id;
    await q(`UPDATE metric_snapshots SET collected_hour = collected_hour - interval '1 day' WHERE social_account_id=$1`, [id]);
    routes.unshift([/\/m1\/insights/, () => ({ data: [{ name: 'views', values: [{ value: 6500 }] }] })]);
    await syncAccount(id, 'test');
    const hist = await q<any>(`SELECT value FROM metric_snapshots s JOIN platform_publications p ON p.id=s.publication_id WHERE p.platform_post_id='m1' AND s.metric_key='views' ORDER BY collected_hour`);
    expect(hist.map((h) => h.value)).toEqual([5000, 6500]);
    expect((await metric('m1', 'views'))!.value).toBe(6500);
    // a flaky call that returns nothing must not wipe a known value
    expect((await metric('m1', 'likes'))!.value).toBe(100);
  });
});

describe('Facebook adapter', () => {
  it('falls back per metric when one is deprecated, parses retention graph', async () => {
    const id = await account('facebook', 'P1');
    await saveToken(id, 'page_access', 'PT');
    routes.length = 0;
    routes.push(
      [/\/P1\?fields=/, () => ({ name: 'Page', followers_count: 3000 })],
      [/\/P1\/insights.*metric=page_media_view&/, () => ({ data: [{ name: 'page_media_view', values: [{ value: 400, end_time: '2026-11-02T07:00:00+0000' }] }] })],
      [/\/P1\/insights.*metric=page_total_media_view_unique&/, () => json({ error: { message: '(#100) The value must be a valid insights metric', code: 100 } }, 400)],
      [/\/P1\/insights/, () => ({ data: [] })],
      [/\/P1\/published_posts/, () => ({ data: [{ id: 'P1_9', message: 'Video post', created_time: '2026-10-05T10:00:00+0000', permalink_url: 'https://fb/9',
          attachments: { data: [{ media_type: 'video', type: 'video_inline', target: { id: 'V9' } }] }, shares: { count: 4 }, comments: { summary: { total_count: 6 } } }] })],
      [/\/V9\?fields=length/, () => ({ length: 40 })],
      [/\/P1_9\/insights\?.*metric=post_media_view%2C/, () => json({ error: { message: '(#100) invalid metric post_clicks', code: 100 } }, 400)],
      [/\/P1_9\/insights.*metric=post_media_view&/, () => ({ data: [{ name: 'post_media_view', values: [{ value: 2500 }] }] })],
      [/\/P1_9\/insights.*metric=post_reactions_by_type_total/, () => ({ data: [{ name: 'post_reactions_by_type_total', values: [{ value: { like: 30, love: 5 } }] }] })],
      [/\/P1_9\/insights.*metric=post_clicks/, () => json({ error: { message: '(#100) invalid metric', code: 100 } }, 400)],
      [/\/P1_9\/insights/, () => ({ data: [] })],
      [/\/V9\/video_insights/, () => ({ data: [
        { name: 'total_video_views', values: [{ value: 1800 }] }, { name: 'total_video_avg_time_watched', values: [{ value: 12500 }] },
        { name: 'total_video_retention_graph', values: [{ value: { '0': 1, '10': 0.62, '20': 0.45, '30': 0.33, '40': 0.2 } }] } ] })],
      [/\/P1\/video_reels/, () => ({ data: [] })],
    );
    const res = await syncAccount(id, 'test', 'backfill');
    expect(res.status).toBe('partial'); // one page metric unsupported
    expect(await metric('P1_9', 'views')).toEqual({ value: 2500, availability: 'available' });
    expect(await metric('P1_9', 'reactions')).toEqual({ value: 35, availability: 'available' });
    expect(await metric('P1_9', 'clicks')).toEqual({ value: null, availability: 'not_supported' });
    expect(await metric('P1_9', 'shares')).toEqual({ value: 4, availability: 'available' });
    expect((await metric('P1_9', 'avg_watch_time_sec'))!.value).toBeCloseTo(12.5);
    const curve = await one<any>(`SELECT rc.points FROM retention_curves rc JOIN platform_publications p ON p.id=rc.publication_id WHERE p.platform_post_id='P1_9'`);
    expect(curve.points[1]).toEqual({ r: 0.25, t: 10, v: 0.62 });
    const day = await one<any>(`SELECT period_start::text AS d, value FROM metric_snapshots WHERE social_account_id=$1 AND metric_key='views' AND period='day'`, [id]);
    expect(day).toEqual({ d: '2026-11-01', value: 400 }); // end_time belongs to previous day
  });

  it('marks the account token_expired when Meta rejects the token', async () => {
    const id = await account('facebook', 'P2');
    await saveToken(id, 'page_access', 'BAD');
    routes.length = 0;
    routes.push([/\/P2\?/, () => json({ error: { message: 'Error validating access token: Session has expired', code: 190, type: 'OAuthException' } }, 400)]);
    const res = await syncAccount(id, 'test');
    expect(res.status).toBe('failed');
    expect((await one<any>('SELECT status FROM social_accounts WHERE id=$1', [id])).status).toBe('token_expired');
    expect((await one<any>(`SELECT count(*)::int AS n FROM integration_logs WHERE social_account_id=$1 AND level='error'`, [id])).n).toBe(1);
  });
});

describe('YouTube adapter', () => {
  it('refreshes token, syncs videos, analytics, retention and reach reports', async () => {
    const id = await account('youtube', 'UC1');
    await saveToken(id, 'refresh', 'RT');
    routes.length = 0;
    let refreshed = 0;
    const rows = (cols: string[], data: any[][]) => ({ columnHeaders: cols.map((name) => ({ name })), rows: data });
    routes.push(
      [/oauth2\.googleapis\.com\/token/, () => { refreshed++; return { access_token: 'AT', expires_in: 3600 }; }],
      [/youtube\/v3\/channels/, () => ({ items: [{ id: 'UC1', statistics: { subscriberCount: '950', hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] })],
      [/youtube\/v3\/playlistItems/, () => ({ items: [{ contentDetails: { videoId: 'vid1' } }] })],
      [/youtube\/v3\/videos/, () => ({ items: [{ id: 'vid1', snippet: { title: 'Demo #shorts', description: 'd', publishedAt: '2026-10-01T00:00:00Z', thumbnails: {} }, contentDetails: { duration: 'PT45S' }, statistics: {} }] })],
      [/reports.*dimensions=day/, () => rows(['day', 'views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'], [['2026-11-01', 100, 50, 3, 1]])],
      [/reports.*dimensions=video&/, () => rows(['video', 'views', 'likes', 'comments', 'shares', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost'], [['vid1', 1000, 40, 5, 3, 300, 18, 40, 2, 0]])],
      [/reports.*dimensions=elapsedVideoTimeRatio/, () => rows(['elapsedVideoTimeRatio', 'audienceWatchRatio', 'relativeRetentionPerformance'], [[0.01, 1.1, 0.6], [0.5, 0.55, 0.5], [1.0, 0.3, 0.4]])],
      [/youtubeanalytics.*reports/, () => rows(['x', 'views'], [])],
      [/youtubereporting.*\/jobs$/, (_u, init) => (init?.method === 'POST' ? { id: 'J1', reportTypeId: 'channel_reach_basic_a1' } : { jobs: [] })],
      [/youtubereporting.*\/jobs\/J1\/reports/, () => ({ reports: [{ id: 'R1', createTime: '2026-11-03T00:00:00Z', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/R1?alt=media' }] })],
      [/youtubereporting.*media\/R1/, () => new Response('date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261101,UC1,vid1,4000,0.05\n20261102,UC1,vid1,6000,0.04\n')],
    );
    const res = await syncAccount(id, 'test', 'backfill');
    expect(res.status).toBe('succeeded');
    expect(refreshed).toBe(1);
    expect(await metric('vid1', 'views')).toEqual({ value: 1000, availability: 'available' });
    expect((await metric('vid1', 'total_watch_time_sec'))!.value).toBe(18000);
    expect((await metric('vid1', 'impressions'))!.value).toBe(10000);
    expect((await metric('vid1', 'ctr'))!.value).toBeCloseTo(0.044);
    const pub = await one<any>(`SELECT duration_sec, format FROM platform_publications WHERE platform_post_id='vid1'`);
    expect(pub).toEqual({ duration_sec: 45, format: 'short_or_video' });
    const curve = await one<any>(`SELECT points FROM retention_curves rc JOIN platform_publications p ON p.id=rc.publication_id WHERE p.platform_post_id='vid1'`);
    expect(curve.points).toHaveLength(3);
  });
});
