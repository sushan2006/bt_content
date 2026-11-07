/**
 * Publishing approved versions.
 *  Instagram  Reels via the Content Publishing API (resumable upload -> container -> media_publish)
 *  Facebook   Page Reels (start -> upload -> finish)
 *  YouTube    resumable videos.insert (a 9:16 video under 3 minutes becomes a Short)
 * Every published post is stored as a platform publication linked to the job's content item, so Phase 1 measures it.
 * When an API cannot do it (no connected account, missing permission, unaudited YouTube project...) the job is marked
 * "manual" with the reason, and the file stays ready to post by hand.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { graphBase } from '../integrations/meta.js';
import { googleAccessToken, metaToken } from '../integrations/tokens.js';
import { ApiError, request, sleep } from '../lib/http.js';
import { enqueue } from '../jobs/queue.js';
import { assignPublicationCode } from '../routes/content.js';
import { getWorkspace, gmailSend, driveMove, workspaceToken } from '../integrations/workspace.js';
import { publishedEmail } from './emails.js';
import { ensureVersionLocal, planInputs, renderVersion, studioSettings } from './pipeline.js';
import { styleRequest } from './styles.js';
import { studio } from './studioClient.js';

const FORMAT = { instagram: 'reel', facebook: 'reel', youtube: 'short' } as const;

function captionFor(platform: string, plan: any) {
  const md = plan?.metadata ?? {};
  if (platform === 'instagram') return { caption: md.instagram?.caption ?? '' };
  if (platform === 'facebook') return { caption: md.facebook?.description ?? '' };
  return { title: md.youtube?.title ?? plan?.title ?? 'New video', caption: md.youtube?.description ?? '', tags: md.youtube?.tags ?? [] };
}

export async function schedulePublishing(job: any) {
  const settings = await studioSettings();
  const ver = await one<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND variant=$3 AND aspect='9:16'`, [job.id, job.revision, job.approved_variant]);
  if (!ver) throw new Error('Approved version not found');
  let ytVersion = ver;
  // optional landscape YouTube video from landscape footage
  if (job.brief?.youtube_landscape && job.platforms.includes('youtube')) {
    const takes = job.analysis?.takes ?? [];
    const landscape = (await q<any>(`SELECT width, height FROM production_files WHERE job_id=$1 AND kind='take'`, [job.id])).length && takes.length;
    if (landscape) {
      const { inputs } = await planInputs(job);
      const sr = await styleRequest(job.approved_variant);
      const out = await studio.plan({ inputs: { ...inputs, style_profile: sr.style_profile }, variant: sr.variant, aspect: '16:9', overrides: job.overrides ?? [], use_llm: true });
      const v169 = await one<any>(`INSERT INTO production_versions (job_id, revision, variant, aspect, label, plan, summary, status) VALUES ($1,$2,$3,'16:9',$4,$5,$6,'planned')
                                   ON CONFLICT (job_id, revision, variant, aspect) DO UPDATE SET plan=EXCLUDED.plan, summary=EXCLUDED.summary RETURNING *`,
        [job.id, job.revision, job.approved_variant, ver.label, JSON.stringify(out.plan), JSON.stringify(out.summary)]);
      await q(`UPDATE production_jobs SET status_detail='Rendering the landscape YouTube version' WHERE id=$1`, [job.id]);
      ytVersion = await renderVersion(job, v169);
    }
  }
  const when = job.publish_at ? new Date(job.publish_at) : new Date();
  for (const platform of job.platforms as string[]) {
    if (!['instagram', 'facebook', 'youtube'].includes(platform)) continue;
    const acc = await one<any>(`SELECT id FROM social_accounts WHERE platform_code=$1 AND status='connected' AND data_origin='live' ORDER BY created_at LIMIT 1`, [platform]);
    const v = platform === 'youtube' ? ytVersion : ver;
    const meta = captionFor(platform, v.plan);
    const format = platform === 'youtube' && v.aspect === '16:9' ? 'video' : FORMAT[platform as keyof typeof FORMAT];
    const manual = !acc || settings.auto_publish_after_approval === false || job.data_origin === 'demo';
    const reason = job.data_origin === 'demo' ? 'Demo job: not published to real accounts' : !acc ? `No ${platform} account connected` : settings.auto_publish_after_approval === false ? 'Automatic publishing is switched off in Studio settings' : null;
    await q(`INSERT INTO publish_jobs (job_id, version_id, platform_code, social_account_id, format, scheduled_at, status, title, caption, error)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (job_id, platform_code, format) DO UPDATE SET version_id=EXCLUDED.version_id, scheduled_at=EXCLUDED.scheduled_at, status=EXCLUDED.status,
               title=EXCLUDED.title, caption=EXCLUDED.caption, error=EXCLUDED.error, updated_at=now()`,
      [job.id, v.id, platform, acc?.id ?? null, format, when, manual ? 'manual' : 'scheduled', meta.title ?? null, meta.caption ?? '', reason]);
  }
  await q(`UPDATE production_jobs SET status='publishing', status_detail=$2, updated_at=now() WHERE id=$1`,
    [job.id, when.getTime() > Date.now() + 60_000 ? `Scheduled for ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Publishing now']);
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
  // finish jobs whose platform posts are all done
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

async function publishInstagram(pj: any, file: string) {
  const acc = await one<any>('SELECT external_account_id FROM social_accounts WHERE id=$1', [pj.social_account_id]);
  const token = await metaToken(pj.social_account_id);
  const ig = acc.external_account_id;
  const c = await request<any>(`${graphBase()}/${ig}/media`, { method: 'POST', retries: 1, form: { media_type: 'REELS', upload_type: 'resumable', caption: pj.caption ?? '', share_to_feed: 'true', access_token: token } });
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
  const meta = { snippet: { title: (pj.title ?? 'New video').slice(0, 100), description: pj.caption ?? '', categoryId: '28' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const t = await init.text();
    if (init.status === 403 && /insufficient|scope/i.test(t)) throw new Error('YouTube upload permission missing: reconnect YouTube in Integrations (the upload permission was added for Phase 2).');
    throw new Error(`YouTube upload could not start (${init.status}): ${t.slice(0, 300)}`);
  }
  const put = await fetch(init.headers.get('location')!, { method: 'PUT', headers: { 'content-length': String(size), 'content-type': 'video/mp4' }, body: fs.createReadStream(file) as any, duplex: 'half' } as any);
  const body = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`YouTube upload failed (${put.status}): ${JSON.stringify(body).slice(0, 300)}`);
  const id = body.id as string;
  return { id, permalink: pj.format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
}

async function publishOne(pj: any) {
  const settings = await studioSettings();
  const ver = await one<any>('SELECT * FROM production_versions WHERE id=$1', [pj.version_id]);
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [pj.job_id]);
  // in Drive storage mode the local copy is removed after upload: fetch it back for the platform upload
  const file = await ensureVersionLocal(job, ver).catch(() => null);
  if (!file) {
    await q(`UPDATE publish_jobs SET status='failed', error='The rendered file is missing on this computer and in Google Drive' WHERE id=$1`, [pj.id]);
    return;
  }
  ver.output_path = file;
  await q(`UPDATE publish_jobs SET status='uploading', attempts=attempts+1, error=NULL, updated_at=now() WHERE id=$1`, [pj.id]);
  try {
    let res: { id: string; permalink: string | null };
    if (pj.platform_code === 'instagram') res = await publishInstagram(pj, ver.output_path);
    else if (pj.platform_code === 'facebook') res = await publishFacebook(pj, ver.output_path);
    else res = await publishYouTube(pj, ver.output_path, settings.youtube_privacy ?? 'private');
    const pub = await one<any>(
      `INSERT INTO platform_publications (content_item_id, social_account_id, platform_code, platform_post_id, platform_video_id, format, title, caption, permalink, duration_sec, published_at, publishing_status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),'published',$11)
       ON CONFLICT (platform_code, platform_post_id) DO UPDATE SET content_item_id=EXCLUDED.content_item_id, permalink=coalesce(EXCLUDED.permalink, platform_publications.permalink)
       RETURNING id`,
      [job.content_item_id, pj.social_account_id, pj.platform_code, res.id, pj.platform_code === 'facebook' ? res.id : null, pj.format, pj.title ?? job.title, pj.caption ?? null,
       res.permalink, ver.qc?.duration ?? null, JSON.stringify({ studio_job: job.code, version: ver.label })]);
    await assignPublicationCode(pub.id);
    await q(`UPDATE publish_jobs SET status='published', external_id=$2, permalink=$3, publication_id=$4, updated_at=now() WHERE id=$1`, [pj.id, res.id, res.permalink, pub.id]);
    await log(pj.id, `published ${res.permalink ?? res.id}`);
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
  const pjs = await q<any>(`SELECT * FROM publish_jobs WHERE job_id=$1`, [job.id]);
  const done = pjs.filter((p) => p.status === 'published');
  const manual = pjs.filter((p) => p.status === 'manual' || p.status === 'failed');
  await q(`UPDATE production_jobs SET status='published', status_detail=$2, updated_at=now() WHERE id=$1`, [job.id,
    `${done.length ? `Published on ${done.map((p) => p.platform_code).join(', ')}` : 'Ready to post by hand'}${manual.length && done.length ? `; to post by hand: ${manual.map((p) => p.platform_code).join(', ')}` : ''}`]);
  // close the loop: features for the engine + analyse the final video like any other
  const ver = await one<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND variant=$3 AND aspect='9:16'`, [job.id, job.revision, job.approved_variant]);
  const file = ver ? await ensureVersionLocal(job, ver).catch(() => null) : null;
  if (job.content_item_id && ver) {
    // the style as the analysis engine sees it: a built-in style key, or ref_<name> for a style learned from a reference video
    const style = String(job.approved_variant ?? '').startsWith('profile:')
      ? `ref_${(await one<any>('SELECT name FROM style_profiles WHERE id=$1', [String(job.approved_variant).slice(8)]))?.name ?? 'custom'}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
      : job.approved_variant;
    for (const [k, v] of [['edit_style', style], ['ai_edited', 'yes']]) {
      await q(`INSERT INTO content_features (content_item_id, feature_key, value_text, source, confidence) VALUES ($1,$2,$3,'platform',1)
               ON CONFLICT (content_item_id, feature_key) DO UPDATE SET value_text=EXCLUDED.value_text, updated_at=now() WHERE content_features.source <> 'human'`, [job.content_item_id, k, v]);
    }
    if (file) {
      const asset = await one<any>(`INSERT INTO content_assets (content_item_id, asset_type, storage_uri, mime_type, size_bytes, checksum_sha256)
                                    VALUES ($1,'master_video',$2,'video/mp4',$3,$4) ON CONFLICT (content_item_id, checksum_sha256) DO NOTHING RETURNING id`,
        [job.content_item_id, pathToFileURL(file).toString(), fs.statSync(file).size, `studio:${ver.id}`]);
      if (asset && job.data_origin !== 'demo') await enqueue('analyze-video', { contentItemId: job.content_item_id, assetId: asset.id });
    }
  }
  const ws = await getWorkspace();
  const settings = await studioSettings();
  if (ws && !ws.local && (settings.approver_emails ?? []).length && done.length) {
    const mail = publishedEmail({ code: job.code, title: job.title, links: pjs.map((p) => ({ platform: p.platform_code, url: p.permalink, status: p.status })) });
    await gmailSend({ to: settings.approver_emails, ...mail }).catch(() => {});
  }
}
