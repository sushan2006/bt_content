// End-to-end check of the running platform (run RUN_DEMO.bat first):
//   node scripts/e2e-studio.mjs [path-to-raw-video] [--drive] [--styles=editorial,hype] [--machines="Water pump:photo.jpg,Electric motor:photo2.jpg"] [--reference=ref.mp4] [--claude]
//   --claude  also checks the Claude director (needs ANTHROPIC_API_KEY in .env and the planner set to Claude)
// Logs in, opens every dashboard API, then makes a video the way a person would:
//   upload mode: creates a job, uploads the take, starts it, waits for every style to render, approves version A,
//   drive mode:  drops the take + brief.txt into drive_local/Content Studio/content_raw/<folder> and waits for the scan,
// then checks the approved video appears in content_final and on the Completed page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const args = process.argv.slice(2);
const flag = (k) => { const a = args.find((x) => x.startsWith(`--${k}`)); return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : null; };
const video = args.find((a) => !a.startsWith('--'));
const styles = String(flag('styles') || 'editorial,hype').split(',').filter(Boolean);
let cookie = '';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function waitFor(what, fn, timeoutMin = 60) {
  const end = Date.now() + timeoutMin * 60_000;
  let last = '';
  while (Date.now() < end) {
    const v = await fn();
    if (v?.done) return v;
    if (v?.say && v.say !== last) { console.log(`      ${what}: ${v.say}`); last = v.say; }
    await sleep(5000);
  }
  return null;
}

// ---------- 1. login + every dashboard API
const login = await api('POST', '/api/auth/login', { email: 'demo@company.local', password: 'DemoPass123' });
ok('login', login.status === 200, login.status !== 200 ? JSON.stringify(login.data).slice(0, 120) : '');
for (const u of ['/api/health', '/api/auth/me', '/api/analytics/overview?days=30&origin=demo', '/api/analytics/overview?days=30', '/api/brief?origin=demo', '/api/content?origin=demo',
  '/api/content', '/api/publications?unlinked=true', '/api/insights?origin=demo', '/api/recommendations?origin=demo', '/api/experiments?origin=demo', '/api/analytics/platform/youtube?origin=demo',
  '/api/studio/status', '/api/studio/settings', '/api/studio/jobs', '/api/studio/styles', '/api/studio/machines', '/api/studio/music', '/api/studio/completed',
  '/api/users', '/api/roles', '/api/integrations']) {
  const r = await api('GET', u);
  ok(`GET ${u}`, r.status === 200, r.status === 200 ? '' : `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
}
const ov = await api('GET', '/api/analytics/overview?days=365&origin=demo');
ok('overview has the same-video-on-every-platform data', Array.isArray(ov.data?.cross_platform), `${ov.data?.cross_platform?.length ?? 0} videos on 2+ platforms`);
const roles = await api('GET', '/api/roles');
ok('only two roles: Admin and Viewer', roles.data?.map?.((r) => r.code).sort().join(',') === 'admin,viewer', roles.data?.map?.((r) => r.name).join(', '));
const st = await api('GET', '/api/studio/status');
ok('video service connected', !!st.data?.service?.ok, JSON.stringify(st.data?.service ?? st.data).slice(0, 160));

// ---------- 2. optional: learn a style from a reference video, build a machine from a photo
const ref = flag('reference');
if (ref) {
  const r = await api('POST', '/api/studio/styles', form({ name: path.parse(ref).name }, [ref]), true);
  ok('reference video uploaded', r.status === 200, r.data?.error ?? '');
  const done = await waitFor('style', async () => {
    const s = (await api('GET', '/api/studio/styles')).data.find((x) => x.id === r.data.id);
    return s?.status === 'analysing' ? { say: 'analysing' } : { done: true, s };
  }, 10);
  ok('style learned from the reference', done?.s?.status === 'ready', done?.s?.summary ?? done?.s?.error ?? 'timeout');
  if (flag('claude')) ok('Claude wrote a style card', !!done?.s?.card, done?.s?.card?.summary ?? 'no card');
  if (done?.s?.status === 'ready') styles.push(`profile:${done.s.id}`);
}
// several machines, each with a name and photos (the New video form does the same)
const machineIds = [];
const machinesArg = flag('machines') || (flag('photo') ? `Test machine:${flag('photo')}` : null);
for (const spec of String(machinesArg || '').split(',').filter(Boolean)) {
  const [name, photoPath] = spec.split(/:(.+)/);
  const r = await api('POST', '/api/studio/machines', form({ name, notes: '' }, [photoPath], 'photo'), true);
  ok(`machine "${name}" photos uploaded`, r.status === 200, r.data?.error ?? '');
  const done = await waitFor(`machine ${name}`, async () => {
    const m = (await api('GET', '/api/studio/machines')).data.find((x) => x.id === r.data.id);
    return m?.status === 'building' ? { say: 'building the 3D model' } : { done: true, m };
  }, 15);
  ok(`3D model of "${name}" built`, done?.m?.status === 'ready', done?.m?.error ?? `${done?.m?.kind ?? ''}${done?.m?.has_glb ? ', .glb' : ''}`);
  if (flag('claude')) ok(`Claude modelled "${name}" (.glb)`, done?.m?.kind === 'kit' && done?.m?.has_glb, done?.m?.kind ?? '');
  if (done?.m?.status === 'ready') machineIds.push(done.m.id);
}

// ---------- 3. make a video
if (video) {
  let jobId = null;
  if (flag('drive')) {
    const dir = path.join(root, 'drive_local', 'Content Studio', 'content_raw', `E2E water motor ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(video, path.join(dir, path.basename(video)));
    fs.writeFileSync(path.join(dir, 'brief.txt'), `Title: How an electric water motor works\nSpeaker: Sushan\nRole: IoT engineer\nCTA: Follow for more\nKeywords: motor, pump, impeller, stator\nStyles: ${styles.join(', ')}\n`);
    console.log(`      dropped the take in ${dir}`);
    const found = await waitFor('drive scan', async () => {
      await api('POST', '/api/studio/drive/scan', {});
      const j = (await api('GET', '/api/studio/jobs')).data.find((x) => x.source === 'drive' && /water motor/i.test(x.title) && Date.now() - new Date(x.created_at).getTime() < 15 * 60_000);
      return j ? { done: true, j } : { say: 'waiting for the folder to settle and be picked up' };
    }, 10);
    ok('Drive folder picked up as a job', !!found, found?.j?.code ?? 'timeout');
    jobId = found?.j?.id;
  } else {
    const j = await api('POST', '/api/studio/jobs', { title: 'E2E test: how an electric water motor works', styles, machine_ids: machineIds,
      brief: { speaker_name: 'Sushan', speaker_role: 'IoT engineer', cta: 'Follow for more', keywords: ['motor', 'pump', 'impeller'] } });
    ok('job created', j.status === 200, j.data?.code ?? JSON.stringify(j.data).slice(0, 120));
    jobId = j.data?.id;
    const up = await api('POST', `/api/studio/jobs/${jobId}/files`, form({}, [video]), true);
    ok('raw video uploaded', up.status === 200 && up.data?.length === 1, up.data?.error ?? '');
    const s = await api('POST', `/api/studio/jobs/${jobId}/start`, {});
    ok('job started', s.status === 200, s.data?.error ?? '');
  }
  if (jobId) {
    const t0 = Date.now();
    const ready = await waitFor('job', async () => {
      const j = (await api('GET', `/api/studio/jobs/${jobId}`)).data;
      if (j?.job?.status === 'waiting_suggestions') await api('POST', `/api/studio/jobs/${jobId}/skip-suggestions`, {});
      if (['in_review', 'failed', 'approved', 'published'].includes(j?.job?.status)) return { done: true, j };
      return { say: `${j?.job?.status} ${j?.job?.status_detail ?? ''}` };
    }, 120);
    const j = ready?.j;
    ok('every style rendered and sent for review', j?.job?.status === 'in_review', `${j?.job?.status} in ${Math.round((Date.now() - t0) / 60000)} min${j?.job?.error ? `: ${j.job.error}` : ''}`);
    if (machineIds.length) ok('every machine attached to the video', (j?.job?.machines ?? []).length === machineIds.length, (j?.job?.machines ?? []).map((m) => m.name).join(', '));
    if (machineIds.length) {
      const graphics = (j?.versions ?? []).flatMap((v) => (v.plan_graphics ?? []));
      ok('machines appear in the edit notes', (j?.versions ?? []).some((v) => JSON.stringify(v.summary ?? {}).toLowerCase().includes('machine')), `${graphics.length} graphics`);
    }
    // a Viewer can watch and suggest but cannot approve or create
    const vEmail = `viewer.e2e.${Date.now()}@company.local`;
    await api('POST', '/api/users', { email: vEmail, full_name: 'E2E Viewer', password: 'ViewerPass123', role: 'viewer' });
    const adminCookie = cookie;
    const vl = await api('POST', '/api/auth/login', { email: vEmail, password: 'ViewerPass123' });
    ok('viewer can log in', vl.status === 200, vl.data?.user?.role);
    ok('viewer can open the video', (await api('GET', `/api/studio/jobs/${jobId}`)).status === 200);
    ok('viewer can add a suggestion', (await api('POST', `/api/studio/jobs/${jobId}/suggestions`, { text: 'E2E: looks good' })).status === 200);
    ok('viewer cannot approve', (await api('POST', `/api/studio/jobs/${jobId}/approve`, { variant: styles[0] })).status === 403);
    ok('viewer cannot create a video', (await api('POST', '/api/studio/jobs', { title: 'nope' })).status === 403);
    ok('viewer cannot open Settings › Users', (await api('GET', '/api/users')).status === 403);
    cookie = adminCookie;
    const vs = (j?.versions ?? []).filter((v) => v.aspect === '9:16');
    if (flag('claude')) {
      const d = j?.job?.director ?? {};
      ok('Claude planned every style', vs.length > 0 && vs.every((v) => v.planner === 'claude'), vs.map((v) => `${v.label}:${v.planner}`).join(' '));
      ok('progress shown step by step', (d.progress ?? []).filter((p) => p.major).length >= 3, `${(d.progress ?? []).length} progress lines`);
      ok('research notes saved', !!d.research?.summary, d.research?.topic ?? '');
      ok('3D assets built and kept in the library', (j?.assets ?? []).length > 0, (j?.assets ?? []).map((a) => a.name).join(', '));
      ok('Claude cost recorded', typeof d.usage?.cost_usd === 'number', `$${d.usage?.cost_usd}`);
    }
    for (const v of vs) {
      const r = await fetch(`${BASE}/api/studio/versions/${v.id}/video`, { headers: { cookie, range: 'bytes=0-1023' } });
      ok(`version ${v.label} (${v.name ?? v.variant}) plays`, r.status === 206 || r.status === 200, `${v.qc?.ok === false ? 'QC issues, ' : ''}rendered in ${v.render_seconds ?? '?'} s`);
    }
    if (j?.job?.status === 'in_review') {
      const first = vs.find((v) => v.label === 'A') ?? vs[0];
      const a = await api('POST', `/api/studio/jobs/${jobId}/approve`, { variant: first.variant });
      ok(`version ${first.label} approved in the dashboard`, a.status === 200, a.status === 200 ? '' : JSON.stringify(a.data).slice(0, 160));
      const fin = await waitFor('final', async () => {
        const c = (await api('GET', '/api/studio/completed')).data;
        const it = c?.items?.find((i) => i.job?.id === jobId);
        return it && (!c.drive?.google || it.in_google) ? { done: true, it, folder: c.folder } : { say: it ? `${it.where}${it.job?.final_error ? `: ${it.job.final_error}` : ''}` : 'waiting for content_final' };
      }, 5);
      ok('approved video is in content_final and on the Completed page', !!fin, fin ? `${fin.it.name} in ${fin.folder}` : 'timeout');
      if (fin) {
        const r = await fetch(BASE + fin.it.stream, { headers: { cookie, range: 'bytes=0-1023' } });
        ok('Completed video streams', r.status === 206 || r.status === 200, `HTTP ${r.status}`);
      }
    }
  }
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
