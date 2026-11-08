// End-to-end check of the running platform (start RUN_DEMO.bat first, then in another window):
//   node scripts/e2e-studio.mjs [path-to-a-take.mp4]
// Without a take, a 3-second test video is generated with FFmpeg.
//
// It goes through the Content Studio the way a person does:
//   every dashboard API and page · the 9 preset styles (each with its prompt template, Simple Edit for plain footage) · a reference style from a video · a machine with a photo
//   · a new video with a take and a picture · the prompt (style spec, links, suggestions, file names) · Copy prompt
//   · the finished video put in content_final with its captions file -> Completed · a video without a job code
//   imported from content_final · a content_raw folder with brief.txt -> a new video · uploading a final on the page
//   · thumbnails: Claude's JOB thumbnail from content_final, an automatic frame, an uploaded picture, a chosen frame, take frames
//   · publishing (no accounts connected -> "post by hand") · "I posted it" -> Published · cancel and reopen
// It uses the local drive folder when Google Drive is not connected (files are cleaned up at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const args = process.argv.slice(2);
let cookie = '';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-studio-'));

async function api(method, url, body, isForm = false) {
  const headers = { cookie };
  if (body && !isForm) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(',').map((c) => c.split(';')[0]).join('; ');
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
function form(fields, files, field = 'file') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const p of files) f.append(field, new Blob([fs.readFileSync(p)]), path.basename(p));
  return f;
}
async function until(fn, seconds = 60) {
  for (let i = 0; i < seconds; i++) { const v = await fn(); if (v) return v; await sleep(1000); }
  return null;
}

// ---------- test media
const { default: ffmpeg } = await import('ffmpeg-static');
const make = (name, color, seconds = 3) => {
  const p = path.join(tmp, name);
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return p;
};
const take = args.find((a) => !a.startsWith('--')) ?? make('take1.mp4', '0x2f5bea');
const ref = make('reference.mp4', '0xc9623f', 4);
const finalA = make('final_a.mp4', '0x18c29c', 2);
const finalB = make('final_b.mp4', '0xffc83d', 2);
const thumbPng = path.join(tmp, 'thumb.png');
spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xc9623f:s=1280x720', '-frames:v', '1', thumbPng]);
const isJpeg = async (url) => { const r = await fetch(BASE + url, { headers: { cookie } }); const b = Buffer.from(await r.arrayBuffer()); return r.status === 200 && b[0] === 0xff && b[1] === 0xd8; };
const photo = path.join(tmp, 'pump.png');
spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x19a287:s=200x200', '-frames:v', '1', photo]);

// ---------- 1. login, every API, every page
const login = await api('POST', '/api/auth/login', { email: process.env.E2E_EMAIL || 'demo@company.local', password: process.env.E2E_PASSWORD || 'DemoPass123' });
ok('login', login.status === 200, login.status !== 200 ? JSON.stringify(login.data).slice(0, 120) : '');
for (const u of ['/api/health', '/api/auth/me', '/api/analytics/overview?days=30', '/api/content', '/api/insights', '/api/recommendations', '/api/integrations', '/api/system/health',
  '/api/studio/status', '/api/studio/settings', '/api/studio/jobs', '/api/studio/styles', '/api/studio/machines', '/api/studio/music', '/api/studio/completed', '/api/users', '/api/roles']) {
  const r = await api('GET', u);
  ok(`GET ${u}`, r.status === 200, r.status === 200 ? '' : `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
}
for (const p of ['/', '/studio', '/studio/new', '/studio/completed', '/studio/styles', '/studio/styles?tab=music', '/studio/settings', '/content', '/integrations']) {
  const r = await fetch(BASE + p, { headers: { cookie } });
  ok(`page ${p}`, r.status === 200 && (await r.text()).includes('<div id="root">'), `HTTP ${r.status}`);
}
const health = (await api('GET', '/api/system/health')).data;
ok('no AI narrative / API key setting left', !('llm_narrative' in (health ?? {})));
const status = (await api('GET', '/api/studio/status')).data;
ok('studio status has no Claude director', !('director' in status) && !('claude' in status) && !('rules' in status));
ok('video service (style measuring) reachable', !!status.service?.ok, JSON.stringify(status.service));
const localRoot = status.workspace?.local ? status.workspace.root : null;
ok('Drive (or the local drive folder) available', !!status.workspace, status.workspace?.email ?? 'none');

// ---------- 2. styles: 9 presets + a reference video
const styles = (await api('GET', '/api/studio/styles')).data;
const presets = styles.filter((s) => s.group === 'preset');
ok('9 preset styles, Simple Edit among them', presets.length === 9 && presets.some((s) => s.key === 'simple_edit' && s.footage_only), presets.map((s) => s.name).join(', '));
ok('presets carry what the card and detail need', presets.every((s) => s.looks && s.best_for && s.technique && s.example_topic));
const refUp = await api('POST', '/api/studio/styles', form({ name: 'E2E reference', notes: 'the fast cuts' }, [ref]), true);
ok('reference video uploaded', refUp.status === 200, refUp.data?.error ?? '');
const refReady = await until(async () => (await api('GET', '/api/studio/styles')).data.find((x) => x.id === refUp.data.id && x.status !== 'analysing'), 60);
ok('reference style measured', refReady?.status === 'ready' && (refReady.report ?? []).length > 0, (refReady?.report ?? [])[0] ?? refReady?.error ?? 'timeout');

// ---------- 3. a machine and a new video
const mach = await api('POST', '/api/studio/machines', form({ name: 'E2E pump', notes: 'green box' }, [photo], 'photo'), true);
ok('machine saved with its photo', mach.status === 200, mach.data?.error ?? '');
const bad = await api('POST', '/api/studio/jobs', { title: 'x', style: 'editorial' });
ok('old renderer styles are refused for new videos', bad.status === 400);
const job = (await api('POST', '/api/studio/jobs', { title: 'E2E water motor', kind: 'footage', style: 'flat_vector',
  brief: { topic: 'How the water motor works and its principle', speaker_name: 'Ravi', keywords: ['impeller'], hashtags: ['IoT'] },
  options: { length_sec: 45, format: '9:16', storyboard: true, music: true, sfx: false }, platforms: ['instagram', 'youtube'], machine_ids: [mach.data.id] })).data;
ok('video created as "Prompt ready"', job?.status === 'prompt_ready' && /^JOB-\d+$/.test(job.code), job?.code ?? JSON.stringify(job).slice(0, 120));
const up = await api('POST', `/api/studio/jobs/${job.id}/files`, form({}, [take]), true);
ok('take uploaded', up.status === 200 && up.data?.[0]?.take_id === 'T1', up.data?.error ?? '');
await api('POST', `/api/studio/jobs/${job.id}/files`, form({ tags: 'pump, motor' }, [photo]), true);
const inDrive = await until(async () => { const d = (await api('GET', `/api/studio/jobs/${job.id}`)).data; return d.files.length === 2 && d.files.every((f) => f.in_drive) ? d : null; }, 30);
ok('take and picture copied to the video\'s Drive folder', !!inDrive, inDrive ? '' : 'not uploaded');
const takeFile = inDrive?.files.find((f) => f.kind === 'take');
ok('the take has a frame for the dashboard', !!takeFile?.has_thumb && await isJpeg(`/api/studio/files/${takeFile.id}/thumbnail`));
ok('the video has a picture before it is finished (the take frame)', inDrive?.job.has_cover === true && await isJpeg(`/api/studio/jobs/${job.id}/thumbnail`));

// ---------- 4. suggestions + the prompt + copy
const sug = await api('POST', `/api/studio/jobs/${job.id}/suggestions`, { text: 'Show the impeller spinning when he says suction' });
ok('suggestion added', sug.status === 200);
const prompt = (await api('GET', `/api/studio/jobs/${job.id}/prompt`)).data.prompt ?? '';
const expectIn = [`# 0. CONTENT STUDIO JOB ${job.code} · E2E water motor`, '**Topic:** How the water motor works and its principle', 'Duration without voiceover: 45 seconds', 'Format: Vertical, 9:16',
  'Storyboard: Enabled', 'Sound effects: Disabled', 'Background music: Enabled', '# CONTENT STUDIO HAND-OFF', 'T1: ', 'pump', 'E2E pump — green box', 'Show the impeller spinning when he says suction',
  `\`${job.code} E2E water motor.mp4\``, `\`${job.code} thumbnail.jpg\``, `\`${job.code} captions.txt\``, 'INSTAGRAM CAPTION:', 'No paid API'];
const missing = expectIn.filter((s) => !prompt.includes(s));
ok('prompt is the style template, filled in, with the material, suggestion and file names', !missing.length && !prompt.includes('{{'), missing.length ? `missing: ${missing.join(' | ')}` : `${prompt.length} characters`);
ok('prompt has no paths on this computer', !/[A-Za-z]:\\|\/sessions\/|\/home\//.test(prompt));
const copied = await api('POST', `/api/studio/jobs/${job.id}/prompt/copied`, {});
ok('Copy prompt -> "Editing with Claude"', copied.data?.status === 'with_claude', copied.data?.status);
const refJob = (await api('POST', '/api/studio/jobs', { title: 'E2E reference style', kind: 'animation', style: `profile:${refUp.data.id}`, brief: { topic: 'A test' }, options: { format: '16:9', length_sec: 20 } })).data;
const refPrompt = (await api('GET', `/api/studio/jobs/${refJob.id}/prompt`)).data.prompt ?? '';
ok('reference style goes into the prompt with its measurements', refPrompt.includes('(learned from a reference video)') && refPrompt.includes('Cuts every') && refPrompt.includes('the fast cuts'));
const simpleJob = (await api('POST', '/api/studio/jobs', { title: 'E2E factory walk', kind: 'footage', style: 'simple_edit', brief: { topic: 'A walk through the factory floor' },
  options: { length_sec: null, format: '16:9', music: false, sfx: false, subtitles: false } })).data;
const simplePrompt = (await api('GET', `/api/studio/jobs/${simpleJob.id}/prompt`)).data.prompt ?? '';
ok('Simple Edit prompt: cuts of the footage, no graphics or subtitles', simplePrompt.includes('no motion graphics') && simplePrompt.includes('Subtitles: Disabled') && simplePrompt.includes('as long as the footage needs') && simplePrompt.includes('thumbnail.jpg'));
const delRef = await api('DELETE', `/api/studio/styles/${refUp.data.id}`);
ok('a reference style in use cannot be deleted', delRef.status === 409);

// ---------- 5. the finished video arrives in content_final
let teaserCode = null;
const finalFolder = localRoot ? path.join(localRoot, 'content_final') : null;
if (!finalFolder) ok('content_final test needs the local drive folder (Google Drive is connected: skipped)', true);
else {
  fs.copyFileSync(finalA, path.join(finalFolder, `${job.code} E2E water motor.mp4`));
  fs.writeFileSync(path.join(finalFolder, `${job.code} captions.txt`), 'INSTAGRAM CAPTION:\nHow does a water motor lift water? 💧\n\nFACEBOOK DESCRIPTION:\nThe water motor, explained.\n\nYOUTUBE TITLE:\nHow a water motor works\n\nYOUTUBE DESCRIPTION:\nEverything in 45 seconds.\n\nYOUTUBE TAGS:\nwater motor, pump\n');
  fs.copyFileSync(thumbPng, path.join(finalFolder, `${job.code} thumbnail.png`));
  const teaser = `E2E launch teaser ${Date.now()}`;
  fs.copyFileSync(finalB, path.join(finalFolder, `${teaser}.mp4`));
  await sleep(6000);   // the scan waits until a file has stopped changing
  const scan = (await api('POST', '/api/studio/completed/scan', {})).data;
  ok('content_final scan links the video by its code', scan.linked?.includes(job.code), JSON.stringify(scan));
  ok('a video without a code is imported as a new completed video', scan.imported?.some((x) => x.includes(teaser)), (scan.imported ?? []).join(', '));
  const d = (await api('GET', `/api/studio/jobs/${job.id}`)).data.job;
  ok('video is Completed with its captions', d.status === 'completed' && d.final_captions?.youtube_title === 'How a water motor works', `${d.status} · ${JSON.stringify(d.final_captions).slice(0, 80)}`);
  ok('Claude\'s thumbnail from content_final is the video\'s thumbnail', d.thumbnail_source === 'claude' && await isJpeg(`/api/studio/jobs/${job.id}/thumbnail`), d.thumbnail_source);
  const vid = await fetch(`${BASE}/api/studio/jobs/${job.id}/final`, { headers: { cookie, range: 'bytes=0-99' } });
  ok('finished video plays from the dashboard (byte ranges)', vid.status === 206, `HTTP ${vid.status}`);
  const again = (await api('POST', '/api/studio/completed/scan', {})).data;
  ok('scanning again changes nothing', !again.linked?.length && !again.imported?.length, JSON.stringify(again));
  const completed = (await api('GET', '/api/studio/completed')).data;
  ok('Completed page lists both', completed.items.some((i) => i.id === job.id) && completed.items.some((i) => i.title === teaser));
  const teaserItem = completed.items.find((i) => i.title === teaser);
  teaserCode = teaserItem?.code;
  const autoT = await until(async () => (await api('GET', '/api/studio/completed')).data.items.find((i) => i.id === teaserItem?.id && i.thumbnail_source === 'auto'), 60);
  ok('a video put in content_final without a thumbnail gets one from its frames', !!autoT && autoT.has_cover && await isJpeg(`/api/studio/jobs/${teaserItem.id}/thumbnail?v=${autoT.cover_v}`), autoT ? '' : 'timeout');
  ok('the automatic thumbnail is saved next to the video in content_final', fs.existsSync(path.join(finalFolder, `${teaserCode} thumbnail.jpg`)));

  // a content_raw folder with a brief becomes a new video
  const raw = path.join(localRoot, 'content_raw', 'E2E raw folder');
  fs.mkdirSync(raw, { recursive: true });
  fs.copyFileSync(take, path.join(raw, 'take 1.mp4'));
  fs.writeFileSync(path.join(raw, 'brief.txt'), 'Title: E2E from Drive\nAbout: sensors on a pump\nStyle: Kinetic typography\nLength: 0:40\n');
  const old = Date.now() / 1000 - 3600;
  for (const f of fs.readdirSync(raw)) fs.utimesSync(path.join(raw, f), old, old);
  const sc = (await api('POST', '/api/studio/drive/scan', {})).data;
  const fromDrive = (await api('GET', '/api/studio/jobs')).data.find((j) => j.title === 'E2E from Drive');
  ok('content_raw folder -> new video with the style and length from brief.txt', fromDrive?.styles?.[0] === 'kinetic_type' && fromDrive?.options?.length_sec === 40 && fromDrive?.takes === 1,
    JSON.stringify(sc.raw ?? sc).slice(0, 120));
  if (fromDrive) await api('DELETE', `/api/studio/jobs/${fromDrive.id}`);
}

// ---------- 6. upload a final on the video page
const pageJob = (await api('POST', '/api/studio/jobs', { title: 'E2E page upload', kind: 'animation', style: 'pixel_art', brief: { topic: 'game loop' }, options: { format: '9:16', length_sec: 15 } })).data;
const fin = await api('POST', `/api/studio/jobs/${pageJob.id}/final`, form({ captions: 'INSTAGRAM CAPTION:\nPress jump!\n' }, [finalB]), true);
ok('"Upload final video" completes the video', fin.status === 200, fin.data?.error ?? '');
const pj = (await api('GET', `/api/studio/jobs/${pageJob.id}`)).data.job;
const pjT = (await api('GET', `/api/studio/jobs/${pageJob.id}`)).data.job;
ok('an uploaded final gets an automatic thumbnail straight away', pjT.thumbnail_source === 'auto' && pjT.has_cover, pjT.thumbnail_source);
const tUp = await api('POST', `/api/studio/jobs/${pageJob.id}/thumbnail`, form({}, [thumbPng]), true);
const afterUp = (await api('GET', `/api/studio/jobs/${pageJob.id}`)).data.job;
ok('"Upload a picture" replaces the thumbnail', tUp.status === 200 && afterUp.thumbnail_source === 'upload' && await isJpeg(`/api/studio/jobs/${pageJob.id}/thumbnail`), tUp.data?.error ?? afterUp.thumbnail_source);
const tFr = await api('POST', `/api/studio/jobs/${pageJob.id}/thumbnail/frame`, { time: 1 });
const afterFr = (await api('GET', `/api/studio/jobs/${pageJob.id}`)).data.job;
ok('"Use the paused frame" takes that frame', tFr.status === 200 && afterFr.thumbnail_source === 'frame' && Math.abs(Number(afterFr.thumbnail_time) - 1) < 0.05, tFr.data?.error ?? `${afterFr.thumbnail_source} ${afterFr.thumbnail_time}`);
const badT = await api('POST', `/api/studio/jobs/${pageJob.id}/thumbnail`, form({}, [finalB]), true);
ok('a non-picture is refused as a thumbnail', badT.status === 400);
const pub403 = await fetch(`${BASE}/api/public/covers/${pageJob.id}/1/cover.jpg?sig=wrong`);
ok('the public cover link needs a valid signature', pub403.status === 403 || pub403.status === 404, `HTTP ${pub403.status}`);
ok('uploaded final is named with the code and has its captions', pj.status === 'completed' && pj.final_name === `${pageJob.code} E2E page upload.mp4` && pj.final_captions?.instagram === 'Press jump!', `${pj.status} ${pj.final_name}`);

// ---------- 7. publish (no accounts connected in a test install -> post by hand)
const firstJob = (await api('GET', `/api/studio/jobs/${job.id}`)).data.job;
if (firstJob.status === 'completed') {
  const noTitle = await api('POST', `/api/studio/jobs/${job.id}/publish`, { posts: [{ platform: 'youtube', caption: 'x', title: '' }] });
  ok('YouTube needs a title', noTitle.status === 400);
  const pub = await api('POST', `/api/studio/jobs/${job.id}/publish`, { posts: [{ platform: 'instagram', caption: 'How does a water motor lift water?' }, { platform: 'youtube', caption: 'Everything in 45 seconds.', title: 'How a water motor works', tags: ['water motor'] }] });
  ok('publish accepted', pub.status === 200, pub.data?.error ?? '');
  const after = await until(async () => { const d = (await api('GET', `/api/studio/jobs/${job.id}`)).data; return d.job.status === 'published' ? d : null; }, 90);
  ok('posts finish (published, or "post by hand" when no account is connected)', !!after, after ? after.publishing.map((p) => `${p.platform_code}:${p.status}`).join(', ') : 'timeout');
  const manual = after?.publishing.find((p) => p.status === 'manual');
  if (manual) {
    await api('POST', `/api/studio/publish-jobs/${manual.id}/posted`, { permalink: 'https://www.instagram.com/reel/TEST/' });
    const p2 = (await api('GET', `/api/studio/jobs/${job.id}`)).data.publishing.find((p) => p.id === manual.id);
    ok('"I posted it" records the link', p2?.status === 'published' && p2.permalink?.includes('TEST'));
  }
  const lib = (await api('GET', '/api/content')).data;
  const item = (lib.items ?? lib).find?.((c) => c.studio?.code === job.code);
  ok('Content library shows the studio video with its finished file and thumbnail', item?.studio?.has_final === true && item?.studio?.has_thumb === true, item ? item.studio.status : 'not found');
}

// ---------- 8. cancel + reopen
const c1 = await api('DELETE', `/api/studio/jobs/${refJob.id}`);
const c2 = await api('POST', `/api/studio/jobs/${refJob.id}/reopen`, {});
const reopened = (await api('GET', `/api/studio/jobs/${refJob.id}`)).data.job;
ok('cancel and reopen', c1.status === 200 && c2.status === 200 && reopened.status === 'prompt_ready', reopened.status);
const rp = await api('POST', `/api/studio/jobs/${pageJob.id}/reopen`, {});
const rpj = (await api('GET', `/api/studio/jobs/${pageJob.id}`)).data.job;
ok('"Make changes" sends a completed video back (to "Prompt ready" when its prompt was never copied)', rp.status === 200 && rpj.status === 'prompt_ready' && !rpj.has_final, rpj.status);
if (finalFolder) {
  const rescan = (await api('POST', '/api/studio/completed/scan', {})).data;
  ok('the set-aside final is not picked up again', !rescan.linked?.includes(pageJob.code), JSON.stringify(rescan));
}

// ---------- clean up the test videos
for (const id of [refJob.id, pageJob.id, simpleJob.id]) await api('DELETE', `/api/studio/jobs/${id}`);
await api('DELETE', `/api/studio/styles/${refUp.data.id}`);
await api('DELETE', `/api/studio/machines/${mach.data.id}`);
if (finalFolder) for (const f of fs.readdirSync(finalFolder).filter((n) => n.includes('E2E') || n.startsWith(job.code) || n.startsWith(pageJob.code) || (teaserCode && n.startsWith(teaserCode)))) { try { fs.unlinkSync(path.join(finalFolder, f)); } catch {} }

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
