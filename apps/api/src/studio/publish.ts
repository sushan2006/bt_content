/**
 * Publishing a finished video (from Google Drive › content_final, or uploaded on the video page).
 *  Instagram  Reels via the Content Publishing API (resumable upload -> container -> media_publish)
 *  Facebook   Page Reels (start -> upload -> finish)
 *  YouTube    resumable videos.insert (a 9:16 video under 3 minutes becomes a Short)
 * The captions are written in the dashboard (pre-filled from "<JOB> captions.txt"). Every post is stored as a platform
 * publication linked to the video's content item, so the analytics measure it. When an API cannot post (no connected
 * account, missing permission, unaudited YouTube project...) the post is marked "post by hand" with the reason.
 * The video's thumbnail goes with every post: Instagram's cover (cover_url when this server is reachable from the
 * internet, otherwise the frame offset), Facebook's preferred thumbnail, and YouTube's custom thumbnail.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { graphBase } from '../integrations/meta.js';
import { googleAccessToken, metaToken } from '../integrations/tokens.js';
import { ApiError, request, sleep } from '../lib/http.js';
import { enqueue } from '../jobs/queue.js';
import { assignPublicationCode } from '../routes/content.js';
import { ensureFinalLocal, studioSettings } from './pipeline.js';

export interface PostRequest { platform: 'instagram' | 'facebook' | 'youtube'; caption: string; title?: string | null; tags?: string[] }

const formatFor = (platform: string, job: any) => (platform === 'youtube' ? (job.options?.format === '16:9' ? 'video' : 'short') : 'reel');

export async function schedulePublishing(job: any, posts: PostRequest[], publishAt: Date | null) {
  if (!job.final_drive_file_id && !job.final_path) throw new Error('This video has no finished file yet.');
  if (!posts.length) throw new Error('Pick at least one platform.');
  const when = publishAt ?? new Date();
  for (const p of posts) {
    const acc = await one<any>(`SELECT id FROM social_accounts WHERE platform_code=$1 AND status='connected' AND data_origin='live' ORDER BY created_at LIMIT 1`, [p.platform]);
    const manual = !acc || job.data_origin === 'demo';
    const reason = job.data_origin === 'demo' ? 'Demo video: not posted to real accounts' : !acc ? `No ${p.platform} account is connected (Integrations). Post it by hand.` : null;
    await q(`INSERT INTO publish_jobs (job_id, platform_code, social_account_id, format, scheduled_at, status, title, caption, tags, error)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (job_id, platform_code, format) DO UPDATE SET social_account_id=EXCLUDED.social_account_id, scheduled_at=EXCLUDED.scheduled_at, status=EXCLUDED.status,
               title=EXCLUDED.title, caption=EXCLUDED.caption, tags=EXCLUDED.tags, error=EXCLUDED.error, attempts=0, updated_at=now()
             WHERE publish_jobs.status NOT IN ('published', 'uploading', 'processing')`,
      [job.id, p.platform, acc?.id ?? null, formatFor(p.platform, job), when, manual ? 'manual' : 'scheduled', p.title ?? null, p.caption ?? '', p.tags ?? [], reason]);
  }
  await q(`UPDATE production_jobs SET status='publishing', platforms=$3, publish_at=$4, status_detail=$2, updated_at=now() WHERE id=$1`,
    [job.id, when.getTime() > Date.now() + 60_000 ? `Scheduled for ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Publishing now',
     posts.map((p) => p.platform), when]);
  setImmediate(() => runDuePublishing().catch(console.error));
}

const busy = new Set<string>();

export async function runDuePublishing() {
  const due = await q<any>(`SELECT * FROM publish_jobs WHERE status='scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 3`);
  for (const pj of due) {
    if (busy.has(pj.id)) continue;
    busy.add(pj.id);
    try { await publishOne(pj); } finally { busy.delete(pj.id); }
  }
  // finish videos whose posts are all done
  const jobs = await q<any>(`SELECT j.* FROM production_jobs j WHERE j.status='publishing' AND NOT EXISTS (SELECT 1 FROM publish_jobs p WHERE p.job_id=j.id AND p.status IN ('scheduled','uploading','processing'))`);
  for (const j of jobs) await finishJob(j);
}

async function log(pjId: string, msg: string) {
  await q(`UPDATE publish_jobs SET log = log || $2::jsonb, updated_at=now() WHERE id=$1`, [pjId, JSON.stringify([{ at: new Date().toISOString(), msg }])]);
}

async function rupload(url: string, token: string, file: string, extraHeaders: Record<string, string> = {}) {
  const size = fs.statSync(file).size;
  const res = await fetch(url, { method: 'POST', headers: { authorization: `OAuth ${token}`, offset: '0', file_size: String(size), 'content-type': 'application/octet-stream', ...extraHeaders },
    body: fs.createReadStream(file) as any, duplex: 'half' } as any);
  const body = await res.text();
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

/** A signed, unguessable link to a video's thumbnail, so Instagram can fetch the cover. */
export function coverSignature(jobId: string, version: string) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${jobId}:${version}`).digest('hex').slice(0, 32);
}
function publicCoverUrl(job: any): string | null {
  const base = env.API_PUBLIC_URL.replace(/\/$/, '');
  if (!job.thumbnail_path || !/^https:\/\//i.test(base) || /localhost|127\.0\.0\.1|\.local\b|\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./i.test(base)) return null;
  const v = String(new Date(job.thumbnail_updated_at ?? 0).getTime());
  return `${base}/api/public/covers/${job.id}/${v}/${coverSignature(job.id, v)}.jpg`;
}
async function setThumbStatus(pjId: string, status: string) {
  await q(`UPDATE publish_jobs SET thumbnail_status=$2, updated_at=now() WHERE id=$1`, [pjId, status.slice(0, 300)]);
  await log(pjId, `thumbnail: ${status}`);
}

async function publishInstagram(pj: any, file: string, job: any) {
  const acc = await one<any>('SELECT external_account_id FROM social_accounts WHERE id=$1', [pj.social_account_id]);
  const token = await metaToken(pj.social_account_id);
  const ig = acc.external_account_id;
  const cover = publicCoverUrl(job);
  const thumb: Record<string, string> = cover ? { cover_url: cover } : job.thumbnail_time != null ? { thumb_offset: String(Math.round(Number(job.thumbnail_time) * 1000)) } : {};
  const c = await request<any>(`${graphBase()}/${ig}/media`, { method: 'POST', retries: 1, form: { media_type: 'REELS', upload_type: 'resumable', caption: pj.caption ?? '', share_to_feed: 'true', ...thumb, access_token: token } });
  await setThumbStatus(pj.id, cover ? 'cover sent with the reel' : thumb.thumb_offset ? `frame at ${job.thumbnail_time} s used as the cover` :
    job.thumbnail_path ? 'not sent: Instagram needs the cover at a public https address (set API_PUBLIC_URL to the server\'s public https address); Instagram picks a frame' : 'no thumbnail');
  await log(pj.id, `container ${c.id} created`);
  await rupload(`https://rupload.facebook.com/ig-api-upload/${env.META_GRAPH_VERSION}/${c.id}`, token, file);
  await q(`UPDATE publish_jobs SET status='processing' WHERE id=$1`, [pj.id]);
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const s = await request<any>(`${graphBase()}/${c.id}?fields=status_code,status&access_token=${token}`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video: ${s.status ?? s.status_code}`);
    if (i === 119) throw new Error('Instagram took too long to process the video');
  }
  const pub = await request<any>(`${graphBase()}/${ig}/media_publish`, { method: 'POST', retries: 1, form: { creation_id: c.id, access_token: token } });
  const m = await request<any>(`${graphBase()}/${pub.id}?fields=permalink,timestamp&access_token=${token}`).catch(() => ({}));
  return { id: pub.id as string, permalink: m.permalink ?? null };
}

async function publishFacebook(pj: any, file: string) {
  const acc = await one<any>('SELECT external_account_id FROM social_accounts WHERE id=$1', [pj.social_account_id]);
  const token = await metaToken(pj.social_account_id);
  const page = acc.external_account_id;
  const start = await request<any>(`${graphBase()}/${page}/video_reels`, { method: 'POST', retries: 1, form: { upload_phase: 'start', access_token: token } });
  await log(pj.id, `reel upload ${start.video_id} started`);
  await rupload(start.upload_url ?? `https://rupload.facebook.com/video-upload/${env.META_GRAPH_VERSION}/${start.video_id}`, token, file);
  await q(`UPDATE publish_jobs SET status='processing' WHERE id=$1`, [pj.id]);
  await request<any>(`${graphBase()}/${page}/video_reels`, { method: 'POST', retries: 1, form: { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: pj.caption ?? '', access_token: token } });
  for (let i = 0; i < 90; i++) {
    await sleep(5000);
    const s = await request<any>(`${graphBase()}/${start.video_id}?fields=status,permalink_url&access_token=${token}`).catch(() => null);
    const phase = s?.status?.publishing_phase?.status, vstat = s?.status?.video_status;
    if (vstat === 'error' || s?.status?.processing_phase?.status === 'error') throw new Error('Facebook could not process the video');
    if (phase === 'complete' || vstat === 'ready') return { id: start.video_id as string, permalink: s?.permalink_url ? `https://www.facebook.com${s.permalink_url}` : null };
  }
  return { id: start.video_id as string, permalink: null };
}

async function publishYouTube(pj: any, file: string, privacy: string) {
  const token = await googleAccessToken(pj.social_account_id);
  const size = fs.statSync(file).size;
  const meta = { snippet: { title: (pj.title || 'New video').slice(0, 100), description: pj.caption ?? '', tags: (pj.tags ?? []).slice(0, 30), categoryId: '28' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const t = await init.text();
    if (init.status === 403 && /insufficient|scope/i.test(t)) throw new Error('YouTube upload permission missing: reconnect YouTube in Integrations.');
    throw new Error(`YouTube upload could not start (${init.status}): ${t.slice(0, 300)}`);
  }
  const put = await fetch(init.headers.get('location')!, { method: 'PUT', headers: { 'content-length': String(size), 'content-type': 'video/mp4' }, body: fs.createReadStream(file) as any, duplex: 'half' } as any);
  const body = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`YouTube upload failed (${put.status}): ${JSON.stringify(body).slice(0, 300)}`);
  const id = body.id as string;
  return { id, permalink: pj.format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
}

/** Facebook: the thumbnail becomes the reel's preferred thumbnail. */
async function facebookThumbnail(pj: any, job: any, videoId: string) {
  if (!job.thumbnail_path || !fs.existsSync(job.thumbnail_path)) return setThumbStatus(pj.id, 'no thumbnail');
  const token = await metaToken(pj.social_account_id);
  const fd = new FormData();
  fd.append('access_token', token);
  fd.append('is_preferred', 'true');
  fd.append('source', new Blob([fs.readFileSync(job.thumbnail_path)], { type: 'image/jpeg' }), 'thumbnail.jpg');
  const r = await fetch(`${graphBase()}/${videoId}/thumbnails`, { method: 'POST', body: fd });
  await setThumbStatus(pj.id, r.ok ? 'set as the preferred thumbnail' : `not set (${r.status}: ${(await r.text()).slice(0, 160)})`);
}

/** YouTube: custom thumbnail once the upload has been processed (needs a verified channel). */
async function youtubeThumbnail(pj: any, job: any, videoId: string) {
  if (!job.thumbnail_path || !fs.existsSync(job.thumbnail_path)) return setThumbStatus(pj.id, 'no thumbnail');
  const token = await googleAccessToken(pj.social_account_id);
  for (let i = 0; i < 30; i++) {   // wait for processing (up to about 5 minutes)
    const v = await request<any>(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${videoId}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    const st = v?.items?.[0]?.processingDetails?.processingStatus;
    if (st === 'succeeded' || st === 'failed' || st === 'terminated') break;
    await sleep(10_000);
  }
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: fs.readFileSync(job.thumbnail_path) });
  const t = r.ok ? '' : await r.text();
  await setThumbStatus(pj.id, r.ok ? 'set as the custom thumbnail' : /forbidden|verif/i.test(t) ? 'not set: custom thumbnails need a verified YouTube channel (youtube.com/verify)' : `not set (${r.status}: ${t.slice(0, 160)})`);
}

async function publishOne(pj: any) {
  const settings = await studioSettings();
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [pj.job_id]);
  // the finished video lives in Google Drive: fetch it for the platform upload
  const file = await ensureFinalLocal(job).catch(() => null);
  if (!file) {
    await q(`UPDATE publish_jobs SET status='failed', error='The finished video could not be found on this computer or in Google Drive' WHERE id=$1`, [pj.id]);
    return;
  }
  await q(`UPDATE publish_jobs SET status='uploading', attempts=attempts+1, error=NULL, updated_at=now() WHERE id=$1`, [pj.id]);
  try {
    let res: { id: string; permalink: string | null };
    if (pj.platform_code === 'instagram') res = await publishInstagram(pj, file, job);
    else if (pj.platform_code === 'facebook') res = await publishFacebook(pj, file);
    else res = await publishYouTube(pj, file, settings.youtube_privacy ?? 'private');
    const pub = await one<any>(
      `INSERT INTO platform_publications (content_item_id, social_account_id, platform_code, platform_post_id, platform_video_id, format, title, caption, permalink, published_at, publishing_status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'published',$10)
       ON CONFLICT (platform_code, platform_post_id) DO UPDATE SET content_item_id=EXCLUDED.content_item_id, permalink=coalesce(EXCLUDED.permalink, platform_publications.permalink)
       RETURNING id`,
      [job.content_item_id, pj.social_account_id, pj.platform_code, res.id, pj.platform_code === 'facebook' ? res.id : null, pj.format, pj.title || job.title, pj.caption ?? null,
       res.permalink, JSON.stringify({ studio_job: job.code })]);
    await assignPublicationCode(pub.id);
    await q(`UPDATE publish_jobs SET status='published', external_id=$2, permalink=$3, publication_id=$4, updated_at=now() WHERE id=$1`, [pj.id, res.id, res.permalink, pub.id]);
    await log(pj.id, `published ${res.permalink ?? res.id}`);
    // the thumbnail is set afterwards in the background, so a thumbnail problem never holds up or fails the post
    if (pj.platform_code === 'facebook') setImmediate(() => facebookThumbnail(pj, job, res.id).catch((e) => setThumbStatus(pj.id, `not set: ${(e as Error).message}`)));
    if (pj.platform_code === 'youtube') setImmediate(() => youtubeThumbnail(pj, job, res.id).catch((e) => setThumbStatus(pj.id, `not set: ${(e as Error).message}`)));
  } catch (e) {
    const msg = (e as Error).message;
    const permanent = e instanceof ApiError ? [400, 403].includes(e.status) : /permission|missing|scope|not connected/i.test(msg);
    const retry = !permanent && pj.attempts < 3;
    await q(`UPDATE publish_jobs SET status=$2, error=$3, scheduled_at=CASE WHEN $2='scheduled' THEN now() + interval '10 minutes' ELSE scheduled_at END, updated_at=now() WHERE id=$1`,
      [pj.id, retry ? 'scheduled' : 'failed', `${msg.slice(0, 900)}${retry ? ' (will retry)' : ' The file is ready to post by hand.'}`]);
    await log(pj.id, `error: ${msg.slice(0, 300)}`);
  }
}

async function finishJob(job: any) {
  const pjs = await q<any>(`SELECT * FROM publish_jobs WHERE job_id=$1 AND status <> 'cancelled'`, [job.id]);
  const done = pjs.filter((p) => p.status === 'published');
  const manual = pjs.filter((p) => p.status === 'manual' || p.status === 'failed');
  await q(`UPDATE production_jobs SET status='published', status_detail=$2, updated_at=now() WHERE id=$1`, [job.id,
    `${done.length ? `Published on ${done.map((p) => p.platform_code).join(', ')}` : 'Ready to post by hand'}${manual.length && done.length ? `; to post by hand: ${manual.map((p) => p.platform_code).join(', ')}` : ''}`]);
  if (!job.content_item_id) return;
  // close the loop: the style the video was made in becomes a feature the analytics engine can compare
  const key = job.styles?.[0] ?? null;
  const style = !key ? null : key.startsWith('profile:')
    ? `ref_${(await one<any>('SELECT name FROM style_profiles WHERE id=$1', [key.slice(8)]))?.name ?? 'custom'}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
    : key;
  const features: [string, string][] = [['ai_edited', 'yes'], ...(style ? [['edit_style', style] as [string, string]] : [])];
  for (const [k, v] of features) {
    await q(`INSERT INTO content_features (content_item_id, feature_key, value_text, source, confidence) VALUES ($1,$2,$3,'platform',1)
             ON CONFLICT (content_item_id, feature_key) DO UPDATE SET value_text=EXCLUDED.value_text, updated_at=now() WHERE content_features.source <> 'human'`, [job.content_item_id, k, v]);
  }
  if (job.data_origin === 'demo' || !done.length) return;
  const file = await ensureFinalLocal(job).catch(() => null);
  if (!file) return;
  const asset = await one<any>(`INSERT INTO content_assets (content_item_id, asset_type, storage_uri, mime_type, size_bytes, checksum_sha256)
                                VALUES ($1,'master_video',$2,'video/mp4',$3,$4) ON CONFLICT (content_item_id, checksum_sha256) DO NOTHING RETURNING id`,
    [job.content_item_id, pathToFileURL(file).toString(), fs.statSync(file).size, `studio:${job.final_drive_file_id ?? job.id}`]);
  if (asset) await enqueue('analyze-video', { contentItemId: job.content_item_id, assetId: asset.id });
}
