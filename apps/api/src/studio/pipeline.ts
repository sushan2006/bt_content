/**
 * Content Studio workflow (Phase 2).
 *
 *  new -> waiting_suggestions -> analyzing -> planning -> rendering -> in_review
 *      -> approved -> publishing -> published            (any one approver is enough)
 *      -> changes_requested -> planning (revision + 1)    (change requests become edit operations)
 *      -> rejected
 *
 * Every step is idempotent and resumable: `advance(jobId)` looks at the stored status and does the next step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mediaDir } from '../config.js';
import { one, q } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { isLocal as isLocalToken, isDriveId, currentFolders, getWorkspace, gmailSend, gmailThread, driveShare, driveUpload, driveCreateFolder, driveWriteText, workspaceToken, driveMove } from '../integrations/workspace.js';
import { studio } from './studioClient.js';
import { RULE_PLAIN, rulesFromEngine } from './rules.js';
import { approvalEmail, clarifyEmail, suggestionEmail, VersionCard } from './emails.js';
import { BUILTIN, DEFAULT_STYLES, DIRECTOR_STYLES, isValidStyle, LETTERS, styleName, styleRequest } from './styles.js';

export { BUILTIN, DEFAULT_STYLES } from './styles.js';
export type Variant = string;   // a built-in style key or "profile:<id>"
/** Display names of the built-in styles (sync, for places that cannot await). */
export const VARIANT_NAME: Record<string, string> = Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => [k, v.name]));

export async function studioSettings(): Promise<any> {
  return (await one<any>(`SELECT value FROM app_settings WHERE key='studio'`))?.value ?? {};
}

/** Review happens in the dashboard (colleagues log in and approve) unless email review is switched on in Settings. */
export const emailReview = (settings: any) => settings.review_mode === 'email';
/** With Google Drive connected, videos live in Drive: local copies are a temporary cache, removed once uploaded. */
export async function driveStorage(): Promise<boolean> {
  const settings = await studioSettings();
  if (settings.storage_mode === 'local') return false;
  const ws = await getWorkspace();
  return !!ws && ws.status === 'connected' && !ws.local;
}

/** Downloads any take that is no longer on this computer back from Drive (needed again for a revision). */
export async function ensureTakesLocal(job: any) {
  const missing = await q<any>(`SELECT * FROM production_files WHERE job_id=$1 AND kind='take' AND drive_file_id IS NOT NULL`, [job.id]);
  const need = missing.filter((t) => !fs.existsSync(t.storage_path));
  if (!need.length) return;
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') throw new Error('The takes are only in Google Drive and Drive is not connected');
  const token = await workspaceToken(ws);
  const { driveDownload } = await import('../integrations/workspace.js');
  for (const t of need) {
    await detail(job.id, `Fetching take ${t.take_id} from Google Drive`);
    fs.mkdirSync(path.dirname(t.storage_path), { recursive: true });
    await driveDownload(t.drive_file_id, t.storage_path, token);
  }
}

/** A rendered version as a file on this computer: fetched back from Google Drive when the local copy was cleaned up. */
export async function ensureVersionLocal(job: any, ver: any): Promise<string | null> {
  if (ver?.output_path && fs.existsSync(ver.output_path)) return ver.output_path;
  const src = ver?.drive_file_id ?? null;
  if (!src) return null;
  const dest = ver.output_path ?? path.join(jobDir(job.code), `r${ver.revision}`, `${job.code}_${ver.label}_final.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!isDriveId(src)) {
    if (!fs.existsSync(src)) return null;
    fs.copyFileSync(src, dest);
  } else {
    const ws = await getWorkspace();
    if (!ws || ws.local || ws.status !== 'connected') return null;
    const { driveDownload } = await import('../integrations/workspace.js');
    await driveDownload(src, dest, await workspaceToken(ws));
  }
  if (!ver.output_path) await q(`UPDATE production_versions SET output_path=$2 WHERE id=$1`, [ver.id, dest]);
  return dest;
}

/** Frees disk space once everything is safely in Drive: rendered videos and the raw takes (previews are kept). */
export async function cleanupLocal(job: any) {
  if (!(await driveStorage())) return;
  const files = [
    ...(await q<any>(`SELECT output_path AS p FROM production_versions WHERE job_id=$1 AND drive_file_id IS NOT NULL AND output_path IS NOT NULL`, [job.id])),
    ...(await q<any>(`SELECT storage_path AS p FROM production_files WHERE job_id=$1 AND kind='take' AND drive_file_id IS NOT NULL`, [job.id])),
  ];
  let freed = 0;
  for (const { p } of files) {
    try { if (p && fs.existsSync(p)) { freed += fs.statSync(p).size; fs.unlinkSync(p); } } catch { /* in use: next time */ }
  }
  if (freed) console.log(`[studio ${job.code}] freed ${(freed / 1e6).toFixed(0)} MB on this computer (videos are in Google Drive)`);
}

export function jobDir(code: string) {
  const d = path.join(mediaDir, 'studio', code);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function setStatus(jobId: string, status: string, detail: string | null = null, error: string | null = null) {
  await q(`UPDATE production_jobs SET status=$2, status_detail=$3, error=$4, updated_at=now() WHERE id=$1`, [jobId, status, detail, error]);
}
async function detail(jobId: string, d: string) {
  await q(`UPDATE production_jobs SET status_detail=$2, updated_at=now() WHERE id=$1`, [jobId, d.slice(0, 400)]);
}

// ---------------------------------------------------------------- create
export async function createJob(o: { title: string; brief: any; source: 'upload' | 'drive'; driveFolderId?: string | null; platforms?: string[]; musicTrackId?: string | null;
  publishAt?: string | null; userId?: string | null; origin?: 'live' | 'demo'; styles?: string[] | null; machineIds?: string[] | null }) {
  const settings = await studioSettings();
  const machineIds = [...new Set(o.machineIds ?? [])];
  // brief.txt in a Drive folder can name machines: "Machine: TankSync controller, Pump panel"
  if (!machineIds.length && o.brief?.machine) {
    for (const name of String(o.brief.machine).split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      const id = (await one<any>(`SELECT id FROM machines WHERE lower(name)=lower($1) AND status='ready' ORDER BY created_at DESC LIMIT 1`, [name]))?.id;
      if (id) machineIds.push(id);
    }
  }
  const styles = (o.styles ?? []).filter(isValidStyle);
  const item = await one<any>(`INSERT INTO content_items (title, description, owner_id, data_origin, tags) VALUES ($1,$2,$3,$4,'{studio}') RETURNING id, code`,
    [o.title, o.brief?.notes ?? null, o.userId ?? null, o.origin ?? 'live']);
  const job = await one<any>(
    `INSERT INTO production_jobs (content_item_id, title, brief, source, drive_folder_id, platforms, music_track_id, publish_at, created_by, data_origin, styles, machine_id, machine_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[]) RETURNING *`,
    [item.id, o.title, JSON.stringify(o.brief ?? {}), o.source, o.driveFolderId ?? null, o.platforms ?? settings.default_platforms ?? ['instagram', 'facebook', 'youtube'],
     o.musicTrackId ?? null, o.publishAt ?? null, o.userId ?? null, o.origin ?? 'live', styles.length ? styles : null, machineIds[0] ?? null, machineIds]);
  return job;
}

export async function addFile(jobId: string, f: { kind: string; name: string; storage_path: string; take_id?: string | null; drive_file_id?: string | null; md5?: string | null; size?: number; tags?: string[] }) {
  return one<any>(
    `INSERT INTO production_files (job_id, kind, take_id, name, storage_path, drive_file_id, md5, size_bytes, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (job_id, storage_path) DO UPDATE SET name=EXCLUDED.name, tags=EXCLUDED.tags RETURNING *`,
    [jobId, f.kind, f.take_id ?? null, f.name, f.storage_path, f.drive_file_id ?? null, f.md5 ?? null, f.size ?? null, f.tags ?? []]);
}

// ---------------------------------------------------------------- Google Drive (or the local drive folder)
/** The job's folder in content_midway (created on first use). */
export async function midwayFolder(job: any): Promise<{ ws: any; token: string; folder: string; folders: Record<string, string> } | null> {
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return null;
  const token = await workspaceToken(ws);
  const folders = await currentFolders(ws);
  let folder = job.drive_midway_folder as string | null;
  if (!folder) {
    folder = await driveCreateFolder(`${job.code} ${job.title}`.slice(0, 120), folders.midway, token);
    await q(`UPDATE production_jobs SET drive_midway_folder=$2 WHERE id=$1`, [job.id, folder]);
    job.drive_midway_folder = folder;
  }
  return { ws, token, folder, folders };
}

/** Jobs started in the app: the raw takes are copied to content_midway/<job>/source so Drive has the full record. */
async function copySourceToDrive(job: any) {
  if (job.source !== 'upload' || job.data_origin === 'demo') return;
  try {
    const d = await midwayFolder(job);
    if (!d) return;
    const src = await driveCreateFolder('source', d.folder, d.token);
    for (const t of await q<any>(`SELECT * FROM production_files WHERE job_id=$1 AND kind='take' AND drive_file_id IS NULL`, [job.id])) {
      const f = await driveUpload(t.storage_path, `${t.take_id}_${t.name}`, src, d.token, 'video/mp4');
      await q(`UPDATE production_files SET drive_file_id=$2 WHERE id=$1`, [t.id, f.id]);
    }
  } catch (e) { console.warn(`[studio ${job.code}] could not copy the takes to Drive: ${(e as Error).message}`); }
}

/** suggestions/<JOB> – suggestions log.txt : every suggestion and what the edit did with it. */
export async function writeSuggestionsLog(jobId: string) {
  try {
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
    const ws = await getWorkspace();
    if (!job || !ws || ws.status !== 'connected') return;
    const token = await workspaceToken(ws);
    const folders = await currentFolders(ws);
    const sugg = await q<any>(`SELECT * FROM production_suggestions WHERE job_id=$1 ORDER BY received_at`, [jobId]);
    const lines = [`${job.code} — ${job.title}`, `Status: ${job.status}${job.status_detail ? ` (${job.status_detail})` : ''}`, '',
      sugg.length ? 'Suggestions received:' : 'No suggestions received yet.',
      ...sugg.flatMap((x, i) => [`${i + 1}. From ${x.from_email} via ${x.source} on ${new Date(x.received_at).toLocaleString('en-IN')}`, `   "${x.text.replace(/\s+/g, ' ').slice(0, 600)}"`,
        x.is_none ? '   -> no changes asked' : `   -> applied as: ${(x.ops ?? []).map((o: any) => o.op + (o.text ? ` "${o.text}"` : '')).join(', ') || 'kept for the editor'}${x.unhandled?.length ? `; needs a person: ${x.unhandled.join(' ')}` : ''}`]),
      '', 'To add a suggestion, put a text file in this folder named like:', `   ${job.code} from <your name>.txt`];
    await driveWriteText(`${job.code} – suggestions log.txt`, lines.join('\n'), folders.suggestions, token);
  } catch (e) { console.warn('[studio] suggestions log', (e as Error).message); }
}

/** content_final/<JOB> <title>.mp4 : the approved version. The dashboard lists these under Completed.
 *  Returns where the final video ended up; a failure is stored on the job (final_error) and shown in the dashboard
 *  with a "Send to Drive" button instead of only being written to the log. */
export async function deliverFinal(job: any): Promise<{ ok: boolean; where?: string; error?: string }> {
  const ver = await one<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND variant=$3 AND aspect='9:16'`, [job.id, job.revision, job.approved_variant]);
  const local = !!ver?.output_path && fs.existsSync(ver.output_path);
  // a version that only exists in the local drive folder (rendered before Google was connected) is still a usable file
  const localDriveCopy = ver?.drive_file_id && !isDriveId(ver.drive_file_id) && fs.existsSync(ver.drive_file_id) ? ver.drive_file_id as string : null;
  if (!ver || (!local && !ver.drive_file_id)) {
    const error = 'The approved version could not be found (it was not rendered or its file was removed).';
    await q(`UPDATE production_jobs SET final_error=$2 WHERE id=$1`, [job.id, error]);
    return { ok: false, error };
  }
  await q(`UPDATE production_jobs SET final_path=$2, completed_at=COALESCE(completed_at, now()) WHERE id=$1`, [job.id, local ? ver.output_path : localDriveCopy]);
  try {
    const ws = await getWorkspace();
    if (!ws || ws.status !== 'connected') {
      await q(`UPDATE production_jobs SET final_error=$2 WHERE id=$1`, [job.id, 'Google Drive is not connected: the final video is kept on this computer. Connect Drive in Integrations, then press "Send to Drive".']);
      return { ok: false, where: 'this computer', error: 'Drive not connected' };
    }
    const token = await workspaceToken(ws);
    const google = !isLocalToken(token);
    // already delivered to this kind of storage: nothing to do
    if (job.final_drive_file_id && (google ? isDriveId(job.final_drive_file_id) : fs.existsSync(job.final_drive_file_id))) {
      await q(`UPDATE production_jobs SET final_error=NULL WHERE id=$1`, [job.id]);
      return { ok: true, where: google ? 'Google Drive' : 'local drive folder' };
    }
    const folders = await currentFolders(ws);
    const name = `${job.code} ${job.title}`.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 110) + '.mp4';
    const { driveCopy } = await import('../integrations/workspace.js');
    let f;
    if (google && ver.drive_file_id && isDriveId(ver.drive_file_id)) f = await driveCopy(ver.drive_file_id, name, folders.final, token);   // copy inside Drive, no upload
    else {
      const src = local ? ver.output_path : localDriveCopy;
      if (!src) throw new Error('The approved version is not on this computer and not in Google Drive.');
      f = await driveUpload(src, name, folders.final, token);
    }
    const settings = await studioSettings();
    if (emailReview(settings)) await driveShare(f.id, (settings.approver_emails ?? []).filter(Boolean), token);
    await q(`UPDATE production_jobs SET final_drive_file_id=$2, final_drive_link=$3, final_error=NULL WHERE id=$1`,
      [job.id, f.id, google ? (f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`) : f.webViewLink ?? null]);
    console.log(`[studio ${job.code}] final video put in ${google ? 'Google Drive' : 'the local drive folder'} › content_final`);
    return { ok: true, where: google ? 'Google Drive' : 'local drive folder' };
  } catch (e) {
    const error = `Could not put the final video in Drive: ${(e as Error).message}`.slice(0, 600);
    console.warn(`[studio ${job.code}] ${error}`);
    await q(`UPDATE production_jobs SET final_error=$2 WHERE id=$1`, [job.id, error]);
    return { ok: false, error };
  }
}

/** Finals that are not in Google Drive yet (approved while Drive was not connected, or an upload failed) are sent now. */
export async function syncFinalsToDrive(): Promise<{ sent: string[]; failed: { code: string; error: string }[] }> {
  const out = { sent: [] as string[], failed: [] as { code: string; error: string }[] };
  const ws = await getWorkspace().catch(() => null);
  if (!ws || ws.local || ws.status !== 'connected') return out;
  const jobs = await q<any>(`SELECT * FROM production_jobs WHERE approved_variant IS NOT NULL AND completed_at IS NOT NULL AND data_origin='live'
                               AND (final_drive_file_id IS NULL OR final_drive_file_id ~ '[\\\\/]') ORDER BY completed_at`);
  for (const j of jobs) {
    const r = await deliverFinal(j);
    if (r.ok) out.sent.push(j.code); else out.failed.push({ code: j.code, error: r.error ?? 'unknown error' });
  }
  return out;
}

// ---------------------------------------------------------------- advance
const running = new Set<string>();

export async function advance(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    // keep stepping while a step moves the job forward
    for (let guard = 0; guard < 12; guard++) {
      const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
      if (!job) return;
      const before = job.status;
      try {
        await step(job);
      } catch (e) {
        console.error(`[studio ${job.code}]`, e);
        await setStatus(jobId, 'failed', `Failed while ${before.replace('_', ' ')}`, (e as Error).message.slice(0, 2000));
        return;
      }
      const after = (await one<any>('SELECT status FROM production_jobs WHERE id=$1', [jobId]))!.status;
      if (after === before) return;
    }
  } finally {
    running.delete(jobId);
  }
}

async function step(job: any) {
  switch (job.status) {
    case 'new': return stepNew(job);
    case 'waiting_suggestions': return stepWaitSuggestions(job);
    case 'analyzing': return stepAnalyze(job);
    case 'planning': return stepPlan(job);
    case 'rendering': return stepRender(job);
    case 'approved': return stepApproved(job);
    default: return;
  }
}

async function stepNew(job: any) {
  const settings = await studioSettings();
  const takes = await q<any>(`SELECT * FROM production_files WHERE job_id=$1 AND kind='take' ORDER BY take_id`, [job.id]);
  if (!takes.length) { await detail(job.id, 'Waiting for footage: add at least one take'); return; }
  await copySourceToDrive(job);
  await writeSuggestionsLog(job.id);
  const emails: string[] = emailReview(settings) ? (settings.suggestion_emails ?? []).filter(Boolean) : [];
  const ws = await getWorkspace();
  const skip = job.brief?.skip_suggestions === true;
  const windowH = Number(settings.suggestion_window_hours ?? 0);
  if (!emailReview(settings) && windowH > 0 && !skip) {
    // colleagues add suggestions on the job page in the dashboard before the edit starts
    const deadline = new Date(Date.now() + windowH * 3600_000);
    await q(`UPDATE production_jobs SET suggestion_deadline=$2 WHERE id=$1`, [job.id, deadline]);
    await setStatus(job.id, 'waiting_suggestions', `Open for suggestions in the dashboard until ${deadline.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`);
    return;
  }
  if (emails.length && ws && !skip) {
    const deadline = new Date(Date.now() + Number(settings.suggestion_wait_hours ?? 24) * 3600_000);
    const mail = suggestionEmail({ title: job.title, code: job.code, takes: takes.length, deadline, brief: job.brief });
    try {
      const sent = await gmailSend({ to: emails, ...mail });
      await q(`INSERT INTO email_threads (job_id, kind, revision, to_emails, subject, gmail_thread_id, gmail_message_id, rfc_message_id, sent_at)
               VALUES ($1,'suggestions',1,$2,$3,$4,$5,$6,now())`, [job.id, emails, mail.subject, sent.threadId, sent.id, sent.rfcMessageId]);
      await q(`UPDATE production_jobs SET suggestion_deadline=$2 WHERE id=$1`, [job.id, deadline]);
      await setStatus(job.id, 'waiting_suggestions', `Asked ${emails.length} people for suggestions (until ${deadline.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })})`);
      return;
    } catch (e) {
      await q(`INSERT INTO email_threads (job_id, kind, revision, to_emails, subject, status, error) VALUES ($1,'suggestions',1,$2,$3,'failed',$4)`,
        [job.id, emails, mail.subject, (e as Error).message.slice(0, 500)]);
    }
  }
  await setStatus(job.id, 'analyzing', 'Looking at every take: words, sound and picture');
}

async function stepWaitSuggestions(job: any) {
  const settings = await studioSettings();
  const emails: string[] = (settings.suggestion_emails ?? []).map((e: string) => e.toLowerCase());
  const answered = new Set((await q<any>(`SELECT DISTINCT lower(from_email) AS e FROM production_suggestions WHERE job_id=$1`, [job.id])).map((r) => r.e));
  const all = emailReview(settings) && emails.length > 0 && emails.every((e) => answered.has(e));
  const late = job.suggestion_deadline && new Date(job.suggestion_deadline).getTime() < Date.now();
  if (all || late || job.brief?.skip_suggestions) {
    await q(`UPDATE email_threads SET status='closed' WHERE job_id=$1 AND kind='suggestions' AND status='open'`, [job.id]);
    await setStatus(job.id, 'analyzing', `${answered.size} suggestion reply(ies) received. Looking at every take`);
    await writeSuggestionsLog(job.id);
  }
}

async function stepAnalyze(job: any) {
  await ensureTakesLocal(job);
  const takes = await q<any>(`SELECT * FROM production_files WHERE job_id=$1 AND kind='take' ORDER BY take_id`, [job.id]);
  if (!takes.length) throw new Error('No takes uploaded');
  // names and technical words from the brief, brand kit and machine, so the transcript (and captions) spell them right
  const b = job.brief ?? {};
  const settingsNow = await studioSettings();
  const machineRows = jobMachineIds(job).length ? await q<any>('SELECT name, keywords FROM machines WHERE id = ANY($1::uuid[])', [jobMachineIds(job)]) : [];
  const spellings = String(b.spellings ?? '').split(/[,;]/).map((x: string) => x.split('=').pop()!.trim()).filter(Boolean);
  const hints = [settingsNow.brand?.company_name, settingsNow.brand?.handle?.replace(/^@/, ''), b.speaker_name, b.speaker_role, b.title ?? job.title, ...(b.keywords ?? []),
    ...(settingsNow.glossary ?? []), ...(b.glossary ?? []), ...spellings, ...machineRows.flatMap((m) => [m.name, ...(m.keywords ?? [])])].filter(Boolean).join(', ');
  const res = await studio.analyzeTakes({ takes: takes.map((t) => ({ take_id: t.take_id, path: t.storage_path })), script: b.script ?? null, language: b.language ?? null, hints: hints || null },
    (line) => detail(job.id, line.replace(/^\d\d:\d\d:\d\d /, '')).catch(() => {}));
  await q(`UPDATE production_jobs SET analysis=$2 WHERE id=$1`, [job.id, JSON.stringify(res)]);
  for (const t of res.takes) {
    await q(`UPDATE production_files SET duration_sec=$3, meta=meta || $4 WHERE job_id=$1 AND take_id=$2`,
      [job.id, t.take_id, t.duration, JSON.stringify({ focus: t.focus, faces_found: t.faces_found, noise_db: t.noise_db })]);
  }
  await setStatus(job.id, 'planning', `Chose the best take for each of ${res.selection.lines.length} lines`);
}

const REPO_BRAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../services/analyzer/studio/assets/brand');

/** First use: the company logo shipped with the project becomes the brand kit (cleaned logo + crisp vector redraw + colours). */
export async function ensureBrandKit(): Promise<any> {
  const settings = await studioSettings();
  if (settings.brand?.logo_path && fs.existsSync(settings.brand.logo_path)) return settings;
  const src = path.join(REPO_BRAND, 'logo_source.png');
  if (!fs.existsSync(src)) return settings;
  const dir = path.join(mediaDir, 'studio', 'brand');
  fs.mkdirSync(dir, { recursive: true });
  const info = await studio.logo(src, dir).catch(() => null);
  if (!info) return settings;
  const vec = path.join(REPO_BRAND, 'logo_vector.json');
  const colors = Object.fromEntries(Object.entries(info.palette ?? {}).filter(([k]) => ['primary', 'accent', 'alert', 'dark', 'darker', 'light'].includes(k)));
  const next = { ...settings, brand: { ...(settings.brand ?? {}), logo_source: src, logo_path: info.path, logo_light_path: info.light_path,
    logo_vector_path: fs.existsSync(vec) ? vec : null, colors: { ...(settings.brand?.colors ?? {}), ...colors } } };
  await q(`UPDATE app_settings SET value=$1, updated_at=now() WHERE key='studio'`, [JSON.stringify(next)]);
  return next;
}

/** Everything the planner needs, built from the job, settings, the engine and the suggestions. */
export async function planInputs(job: any) {
  const settings = await ensureBrandKit();
  const files = await q<any>(`SELECT * FROM production_files WHERE job_id=$1`, [job.id]);
  const engine = await rulesFromEngine(job.data_origin === 'demo' ? 'demo' : 'live');
  const sugg = await q<any>(`SELECT * FROM production_suggestions WHERE job_id=$1 AND NOT is_none ORDER BY received_at`, [job.id]);
  const music = job.music_track_id
    ? await one<any>(`SELECT * FROM music_tracks WHERE id=$1 AND is_active AND NOT content_id_registered AND license_path IS NOT NULL`, [job.music_track_id])
    : null;
  const brand = settings.brand ?? {};
  const brief = { ...job.brief, title: job.brief?.title ?? job.title, cta: job.brief?.cta ?? brand.cta, tagline: job.brief?.tagline ?? brand.tagline,
    glossary: [...(settings.glossary ?? []), ...(job.brief?.glossary ?? [])],
    // "Spellings: Beastings=BridgeThings, employer=impeller" -> caption corrections
    corrections: Object.fromEntries(String(job.brief?.spellings ?? '').split(/[,;]/).map((x: string) => x.split('=').map((y) => y.trim())).filter((p: string[]) => p.length === 2 && p[0] && p[1])) };
  return {
    inputs: {
      takes: job.analysis.takes, selection: job.analysis.selection, brief, machines: [] as any[],
      brand: { company_name: brand.company_name ?? '', handle: brand.handle ?? '', logo_path: brand.logo_path ?? null, logo_light_path: brand.logo_light_path ?? null,
        logo_vector_path: brand.logo_vector_path ?? null, colors: brand.colors ?? undefined },
      assets: files.filter((f) => f.kind === 'image').map((f) => ({ path: f.storage_path, tags: f.tags, kind: f.tags.includes('product') ? 'product' : 'photo', title: '' })),
      music: music ? { path: music.storage_path, license_path: music.license_path, title: `${music.title}${music.artist ? ' – ' + music.artist : ''}` } : null,
      rules: engine.rules.map((r) => ({ code: r.code, value: r.value, text: r.text, source: 'engine' })),
      suggestion_ops: sugg.flatMap((s) => s.ops ?? []),
      suggestions_text: sugg.flatMap((s) => [...(s.unhandled ?? []), s.text]).slice(0, 12),
    },
    recommended: engine.recommended_variant as Variant | null,
  };
}

export async function jobStyles(job: any): Promise<string[]> {
  const settings = await studioSettings();
  const want: string[] = (job.styles?.length ? job.styles : settings.variants?.length ? settings.variants : DEFAULT_STYLES).filter(isValidStyle);
  return want.length ? want.slice(0, LETTERS.length) : DEFAULT_STYLES;
}

export const jobMachineIds = (job: any): string[] => (job.machine_ids?.length ? job.machine_ids : job.machine_id ? [job.machine_id] : []);

/** The job's machines that have a finished 3D model, in the order they were added (the first is the main one). */
async function machineInputs(job: any): Promise<any[]> {
  const ids = jobMachineIds(job);
  if (!ids.length) return [];
  const rows = await q<any>(`SELECT * FROM machines WHERE id = ANY($1::uuid[]) AND status='ready' ORDER BY array_position($1::uuid[], id)`, [ids]);
  return rows.filter((m) => m.meta).map((m) => ({ ...m.meta, name: m.name, tagline: m.tagline ?? '', keywords: m.keywords ?? [] }));
}

// ---------------------------------------------------------------- Claude director (Phase 3)
export async function directorSettings() {
  const s = await studioSettings();
  return { planner: 'claude', model: 'claude-opus-5-5', helper_model: 'claude-sonnet-5-5', research: true, check_rounds: 1, budget_usd: 3, ...(s.director ?? {}) };
}

/** Claude plans the edit when it is switched on in Settings and the video service has an API key. */
export async function directorReady(): Promise<{ ok: boolean; why?: string }> {
  const ds = await directorSettings();
  if (ds.planner !== 'claude') return { ok: false, why: 'the planner is set to the automatic rules in Studio settings' };
  const h = await studio.health().catch(() => null);
  if (!h?.director?.claude) return { ok: false, why: 'no ANTHROPIC_API_KEY in .env' };
  return { ok: true };
}

async function directorState(jobId: string, patch: any) {
  await q(`UPDATE production_jobs SET director = coalesce(director, '{}'::jsonb) || $2::jsonb, updated_at=now() WHERE id=$1`, [jobId, JSON.stringify(patch)]);
}

async function directorProgress(jobId: string, revision: number, line: string) {
  const text = line.replace(/^\d\d:\d\d:\d\d /, '');
  const major = text.startsWith('◆ ');
  const entry = { t: new Date().toISOString(), text: text.replace(/^◆ /, ''), major, revision };
  await q(`UPDATE production_jobs SET director = jsonb_set(coalesce(director, '{}'::jsonb), '{progress}',
             (coalesce(director->'progress', '[]'::jsonb) || $2::jsonb)), updated_at=now() WHERE id=$1`, [jobId, JSON.stringify([entry])]);
  if (major) await detail(jobId, entry.text);
}

async function assetLibrary(): Promise<any[]> {
  const rows = await q<any>(`SELECT DISTINCT ON (asset_id) asset_id, spec_path FROM studio_assets ORDER BY asset_id, created_at DESC LIMIT 60`);
  return rows.filter((r) => fs.existsSync(r.spec_path)).map((r) => ({ id: r.asset_id, spec_path: r.spec_path }));
}

async function saveAssets(job: any, assets: any[]) {
  const ws = await getWorkspace().catch(() => null);
  for (const a of assets ?? []) {
    if (!a?.key || !a.spec_path) continue;
    let driveId: string | null = null;
    if (ws && !ws.local && a.glb && fs.existsSync(a.glb)) {
      try {
        const token = await workspaceToken(ws);
        const folders = await currentFolders(ws);
        const target = folders.models ?? folders.machines ?? folders.root;
        if (target) driveId = (await driveUpload(a.glb, `${a.id}.glb`, target, token, 'model/gltf-binary')).id;
      } catch (e) { console.warn('[studio] asset upload', (e as Error).message); }
    }
    await q(`INSERT INTO studio_assets (asset_id, name, spec_key, spec_path, glb_path, preview_path, parts, drive_file_id, source_job_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (spec_key) DO NOTHING`,
      [a.id, a.name ?? a.id, a.key, a.spec_path, a.glb ?? null, a.preview ?? null, a.parts ?? 0, driveId, job.id]);
  }
}

async function stepPlanDirector(job: any, inputs: any, machine: any, styles: string[], recommended: string | null) {
  const ds = await directorSettings();
  const reqs = await Promise.all(styles.map(async (v, i) => ({ key: v, label: LETTERS[i], name: await styleName(v), req: await styleRequest(v) })));
  const claudeStyles = reqs.filter((r) => DIRECTOR_STYLES.has(r.req.variant));
  const ruleStyles = reqs.filter((r) => !DIRECTOR_STYLES.has(r.req.variant));
  // a revision: Claude revises its previous directions with the reviewers' request
  let previous: any = {};
  let request: string | null = null;
  if (job.revision > 1) {
    const prev = await q<any>(`SELECT variant, direction FROM production_versions WHERE job_id=$1 AND revision=$2 AND direction IS NOT NULL`, [job.id, job.revision - 1]);
    const dec = await one<any>(`SELECT note FROM approval_decisions WHERE job_id=$1 AND decision='changes' ORDER BY created_at DESC LIMIT 1`, [job.id]);
    const sugg = await q<any>(`SELECT text FROM production_suggestions WHERE job_id=$1 AND NOT is_none AND received_at > coalesce((SELECT max(created_at) FROM production_versions WHERE job_id=$1 AND revision=$2), 'epoch') ORDER BY received_at`, [job.id, job.revision - 1]).catch(() => []);
    if (prev.length) {
      previous = { research: job.director?.research ?? null, directions: Object.fromEntries(prev.map((p) => [p.variant, p.direction])) };
      request = [dec?.note, ...sugg.map((s: any) => s.text)].filter(Boolean).join('\n') || null;
    }
  }
  await directorState(job.id, { planner: 'claude', revision: job.revision, started_at: new Date().toISOString(), finished_at: null, error: null,
    styles: claudeStyles.map((r) => ({ key: r.key, label: r.label, name: r.name })), ...(job.revision === 1 && !previous.directions ? { progress: [] } : {}) });
  const body = {
    inputs: { ...inputs, machine },
    styles: claudeStyles.map((r) => ({ id: r.key, style: r.req.variant, variant: r.req.variant, name: r.name, label: r.label,
      profile: r.req.style_profile ?? null, card: r.req.style_profile?.card ?? null })),
    settings: { model: ds.model, helper_model: ds.helper_model, research: ds.research, check_rounds: ds.check_rounds, budget_usd: ds.budget_usd },
    library: await assetLibrary(),
    work_dir: path.join(jobDir(job.code), `r${job.revision}`, 'director'),
    previous, request, overrides: job.overrides ?? [],
  };
  const out = claudeStyles.length
    ? await (async () => {
        let chain = Promise.resolve();   // progress lines are written one after another, in order
        const r = await studio.direct(body, (l) => { chain = chain.then(() => directorProgress(job.id, job.revision, l)).catch(() => {}); });
        await chain;
        return r;
      })()
    : { versions: [], research: null, assets: [], usage: null, transcript_words: 0 };
  const byId = new Map(out.versions.map((v: any) => [v.id, v]));
  for (const r of reqs) {
    let v: any = byId.get(r.key);
    if (!v) {   // basic layouts (and anything Claude did not return) use the automatic planner
      await detail(job.id, `Planning version ${r.label} (${r.name})`);
      const o = await studio.plan({ inputs: { ...inputs, machine, style_profile: r.req.style_profile }, variant: r.req.variant, aspect: '9:16', overrides: job.overrides ?? [], use_llm: false });
      v = { plan: o.plan, summary: o.summary, notes: o.notes ?? [], direction: null, planner: 'rules' };
    }
    await q(`INSERT INTO production_versions (job_id, revision, variant, aspect, label, plan, summary, notes, status, style_id, direction, planner)
             VALUES ($1,$2,$3,'9:16',$4,$5,$6,$7,'planned',$8,$9,$10)
             ON CONFLICT (job_id, revision, variant, aspect) DO UPDATE SET label=EXCLUDED.label, plan=EXCLUDED.plan, summary=EXCLUDED.summary, notes=EXCLUDED.notes,
               status='planned', error=NULL, direction=EXCLUDED.direction, planner=EXCLUDED.planner, updated_at=now()`,
      [job.id, job.revision, r.key, r.label, JSON.stringify(v.plan), JSON.stringify(v.summary), v.notes ?? [], r.key.startsWith('profile:') ? r.key.slice(8) : null,
        v.direction ? JSON.stringify(v.direction) : null, v.planner ?? 'rules']);
  }
  await saveAssets(job, out.assets);
  const prevUsage = job.director?.usage_total ?? 0;
  await directorState(job.id, { research: out.research ?? previous.research ?? null, usage: out.usage, usage_total: Math.round((prevUsage + (out.usage?.cost_usd ?? 0)) * 10000) / 10000,
    assets: (out.assets ?? []).map((a: any) => ({ id: a.id, name: a.name, parts: a.parts, key: a.key })), finished_at: new Date().toISOString() });
  const rec = recommended && styles.includes(recommended) ? recommended : styles[0];
  await q(`UPDATE production_jobs SET recommended_variant=$2 WHERE id=$1`, [job.id, rec]);
  await setStatus(job.id, 'rendering', `Rendering ${styles.length} versions`);
}

async function stepPlan(job: any) {
  const { inputs, recommended } = await planInputs(job);
  // every machine of the video is modelled in 3D first; a machine whose model failed is left out (the edit still goes ahead)
  const ids = jobMachineIds(job);
  if (ids.length) {
    const building = await q<any>(`SELECT name FROM machines WHERE id = ANY($1::uuid[]) AND status='building'`, [ids]);
    if (building.length) { await detail(job.id, `Waiting for the 3D model of ${building.map((m) => m.name).join(', ')} to finish building`); return; }
  }
  const machines = await machineInputs(job);
  const machine = machines[0] ?? null;
  inputs.machines = machines;
  const styles = await jobStyles(job);
  const ready = await directorReady();
  if (ready.ok) {
    try {
      return await stepPlanDirector(job, inputs, machine, styles, recommended);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 400);
      console.error(`[studio ${job.code}] director`, e);
      await directorState(job.id, { error: msg, finished_at: new Date().toISOString() });
      await detail(job.id, `Claude director failed (${msg.slice(0, 120)}); using the automatic edit`);
    }
  } else {
    await directorState(job.id, { planner: 'rules', revision: job.revision, why: ready.why });
  }
  for (const [i, v] of styles.entries()) {
    const label = LETTERS[i];
    const name = await styleName(v);
    await detail(job.id, `Planning version ${label} (${name})`);
    const req = await styleRequest(v);
    const out = await studio.plan({ inputs: { ...inputs, machine, style_profile: req.style_profile }, variant: req.variant, aspect: '9:16', overrides: job.overrides ?? [], use_llm: false });
    await q(`INSERT INTO production_versions (job_id, revision, variant, aspect, label, plan, summary, notes, status, style_id, planner)
             VALUES ($1,$2,$3,'9:16',$4,$5,$6,$7,'planned',$8,'rules')
             ON CONFLICT (job_id, revision, variant, aspect) DO UPDATE SET label=EXCLUDED.label, plan=EXCLUDED.plan, summary=EXCLUDED.summary, notes=EXCLUDED.notes, status='planned', error=NULL, direction=NULL, planner='rules', updated_at=now()`,
      [job.id, job.revision, v, label, JSON.stringify(out.plan), JSON.stringify(out.summary), out.notes ?? [], v.startsWith('profile:') ? v.slice(8) : null]);
  }
  const rec = recommended && styles.includes(recommended) ? recommended : styles[0];
  await q(`UPDATE production_jobs SET recommended_variant=$2 WHERE id=$1`, [job.id, rec]);
  await setStatus(job.id, 'rendering', `Rendering ${styles.length} versions`);
}

function previewTimes(plan: any): number[] {
  const speech = plan.clips.reduce((s: number, c: any) => s + (c.t_out - c.t_in), 0);
  const ts = [Math.min(1.2, speech * 0.1), speech * 0.33, speech * 0.62];
  if (plan.end_card_seconds) ts.push(speech + Math.min(2.2, plan.end_card_seconds - 0.2));
  else ts.push(Math.max(0, speech - 1));
  return ts.map((t) => Math.round(t * 100) / 100);
}

export async function renderVersion(job: any, ver: any, onLog?: (l: string) => void) {
  const dir = path.join(jobDir(job.code), `r${ver.revision}`);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${job.code}_${ver.label}_${String(ver.variant).replace(/[^\w-]+/g, '-')}_${ver.aspect.replace(':', 'x')}.mp4`);  // no ':' (profile:<id>) in Windows file names
  await q(`UPDATE production_versions SET status='rendering', error=NULL, updated_at=now() WHERE id=$1`, [ver.id]);
  try {
    const rep = await studio.render({ plan: ver.plan, out_path: out, preview_times: previewTimes(ver.plan) }, onLog);
    await q(`UPDATE production_versions SET status='ready', output_path=$2, previews=$3, qc=$4, render_seconds=$5, updated_at=now() WHERE id=$1`,
      [ver.id, out, rep.previews ?? [], JSON.stringify({ ok: rep.ok, checks: rep.checks, duration: rep.duration, lufs: rep.lufs, true_peak: rep.true_peak }), rep.seconds]);
    return { ...ver, output_path: out, previews: rep.previews ?? [], qc: rep };
  } catch (e) {
    await q(`UPDATE production_versions SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [ver.id, (e as Error).message.slice(0, 1500)]);
    throw e;
  }
}

async function stepRender(job: any) {
  await ensureTakesLocal(job);
  const versions = await q<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND aspect='9:16' ORDER BY label`, [job.id, job.revision]);
  for (const v of versions) {
    if (v.status === 'ready' && ((v.output_path && fs.existsSync(v.output_path)) || v.drive_file_id)) continue;
    await detail(job.id, `Rendering version ${v.label} (${await styleName(v.variant)})`);
    await renderVersion(job, v, (l) => detail(job.id, `Version ${v.label}: ${l.replace(/^\d\d:\d\d:\d\d /, '')}`).catch(() => {}));
  }
  await shareForReview(job);
}

/** Uploads the versions to Drive (03 Pending approval), shares them view-only with the approvers and sends the approval email. */
export async function shareForReview(job: any) {
  const settings = await studioSettings();
  const approvers: string[] = emailReview(settings) ? (settings.approver_emails ?? []).filter(Boolean) : [];
  const versions = await q<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND aspect='9:16' ORDER BY label`, [job.id, job.revision]);
  const ws = await getWorkspace();
  try {
    const d = await midwayFolder(job);
    if (d) {
      for (const v of versions) {
        if ((v.drive_file_id && (isLocalToken(d.token) || isDriveId(v.drive_file_id))) || !v.output_path || !fs.existsSync(v.output_path)) continue;
        await detail(job.id, `Uploading version ${v.label} to content_midway`);
        const f = await driveUpload(v.output_path, `${job.code} r${v.revision} ${v.label} ${await styleName(v.variant)}.mp4`.replace(/[<>:"/\\|?*]+/g, '_'), d.folder, d.token);
        if (approvers.length) await driveShare(f.id, approvers, d.token);
        await q(`UPDATE production_versions SET drive_file_id=$2, drive_link=$3 WHERE id=$1`, [v.id, f.id, f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`]);
      }
    }
  } catch (e) {
    console.warn(`[studio ${job.code}] Drive upload failed: ${(e as Error).message}`);
  }
  const fresh = await q<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND aspect='9:16' ORDER BY label`, [job.id, job.revision]);
  await setStatus(job.id, 'in_review', approvers.length ? `Waiting for approval from ${approvers.join(', ')}` : 'Ready for review: open the job in the dashboard to approve or ask for changes');
  if (approvers.length && ws && !ws.local) await sendApprovalEmail(job, fresh, approvers);
  await cleanupLocal(job);
}

async function sendApprovalEmail(job: any, versions: any[], approvers: string[]) {
  const latest = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [job.id]);
  const lastDecision = await one<any>(`SELECT * FROM approval_decisions WHERE job_id=$1 AND decision='changes' ORDER BY created_at DESC LIMIT 1`, [job.id]);
  const sugg = await q<any>(`SELECT text FROM production_suggestions WHERE job_id=$1 AND NOT is_none`, [job.id]);
  const names = await Promise.all(versions.map((v) => styleName(v.variant)));
  const cards: VersionCard[] = versions.map((v, i) => ({
    label: v.label, name: names[i], length: v.summary?.length ?? 0, link: v.drive_link, cid: v.previews?.[1] ? `v${v.label}` : null,
    highlights: (v.summary?.steps ?? []).filter((s: any) => !/^Line /.test(s.what)).slice(0, 3).map((s: any) => s.what.split(' (')[0]),
    recommended: v.variant === latest.recommended_variant,
  }));
  const rulesUsed = [...new Set(versions.flatMap((v) => (v.plan?.rules ?? []).filter((r: any) => r.applied).map((r: any) => RULE_PLAIN[r.code] ?? r.code)))];
  const mail = approvalEmail({ title: job.title, code: job.code, revision: job.revision, versions: cards,
    changes: lastDecision?.note ? [lastDecision.note] : [], suggestions: sugg.map((s) => s.text).slice(0, 4), rulesUsed });
  const prev = await one<any>(`SELECT * FROM email_threads WHERE job_id=$1 AND kind='approval' AND gmail_thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [job.id]);
  try {
    const sent = await gmailSend({ to: approvers, ...mail, threadId: prev?.gmail_thread_id, inReplyTo: prev?.rfc_message_id,
      images: versions.filter((v) => v.previews?.[1]).map((v) => ({ cid: `v${v.label}`, path: v.previews[1] })) });
    await q(`UPDATE email_threads SET status='closed' WHERE job_id=$1 AND kind='approval' AND status='open'`, [job.id]);
    await q(`INSERT INTO email_threads (job_id, kind, revision, to_emails, subject, gmail_thread_id, gmail_message_id, rfc_message_id, sent_at)
             VALUES ($1,'approval',$2,$3,$4,$5,$6,$7,now())`, [job.id, job.revision, approvers, mail.subject, sent.threadId, sent.id, sent.rfcMessageId]);
  } catch (e) {
    await q(`INSERT INTO email_threads (job_id, kind, revision, to_emails, subject, status, error) VALUES ($1,'approval',$2,$3,$4,'failed',$5)`,
      [job.id, job.revision, approvers, mail.subject, (e as Error).message.slice(0, 500)]);
  }
}

// ---------------------------------------------------------------- decisions
export async function recordSuggestion(jobId: string, fromEmail: string, text: string, source: 'email' | 'app' | 'drive') {
  const isNone = /^\s*(none|no|nope|no suggestions?|nothing|all good|nothing from me|no changes)\b[\s.!]*$/i.test(text.trim().split('\n')[0]);
  let ops: any[] = [], unhandled: string[] = [];
  if (!isNone) {
    const job = await one<any>('SELECT analysis FROM production_jobs WHERE id=$1', [jobId]);
    const r = await studio.parseRequest(text, { lines: (job?.analysis?.selection?.lines ?? []).map((l: any, i: number) => `${i + 1}. ${l.text}`) }).catch(() => ({ ops: [], unhandled: [text] }));
    ops = r.ops; unhandled = r.unhandled;
  }
  const row = await one<any>(`INSERT INTO production_suggestions (job_id, from_email, text, ops, unhandled, is_none, source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [jobId, fromEmail.toLowerCase(), text.slice(0, 4000), JSON.stringify(ops), unhandled, isNone, source]);
  setImmediate(() => writeSuggestionsLog(jobId).catch(() => {}));
  return row;
}

export async function approve(jobId: string, variant: string | null, by: { email?: string | null; userId?: string | null }, via: 'email' | 'app', note?: string) {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  if (!job || job.status !== 'in_review') throw new Error(`This video is not waiting for approval (status: ${job?.status})`);
  const v = variant ?? job.recommended_variant;
  const ver = await one<any>(`SELECT * FROM production_versions WHERE job_id=$1 AND revision=$2 AND variant=$3 AND aspect='9:16' AND status='ready'`, [jobId, job.revision, v]);
  if (!ver) throw new Error(`That version is not ready yet`);
  await q(`INSERT INTO approval_decisions (job_id, revision, decision, variant, by_email, by_user, via, note) VALUES ($1,$2,'approve',$3,$4,$5,$6,$7)`,
    [jobId, job.revision, v, by.email ?? null, by.userId ?? null, via, note ?? null]);
  await q(`UPDATE production_jobs SET approved_variant=$2, approved_by_email=$3, approved_at=now() WHERE id=$1`, [jobId, v, by.email ?? null]);
  await q(`UPDATE email_threads SET status='answered' WHERE job_id=$1 AND kind='approval' AND status='open'`, [jobId]);
  await setStatus(jobId, 'approved', `Version ${ver.label} (${await styleName(v)}) approved by ${by.email ?? 'a manager in the app'}`);
  await audit(by.userId ?? null, 'studio.approve', 'production_job', jobId, { variant: v, via, by: by.email });
  setImmediate(() => advance(jobId).catch(console.error));
}

export async function reject(jobId: string, by: { email?: string | null; userId?: string | null }, via: 'email' | 'app', note?: string) {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  if (!job) throw new Error('Not found');
  await q(`INSERT INTO approval_decisions (job_id, revision, decision, by_email, by_user, via, note) VALUES ($1,$2,'reject',$3,$4,$5,$6)`,
    [jobId, job.revision, by.email ?? null, by.userId ?? null, via, note ?? null]);
  await q(`UPDATE email_threads SET status='answered' WHERE job_id=$1 AND kind='approval' AND status='open'`, [jobId]);
  await setStatus(jobId, 'rejected', `Not approved by ${by.email ?? 'a manager in the app'}${note ? `: ${note.slice(0, 200)}` : ''}`);
  await audit(by.userId ?? null, 'studio.reject', 'production_job', jobId, { via, by: by.email });
}

export async function requestChanges(jobId: string, text: string, by: { email?: string | null; userId?: string | null }, via: 'email' | 'app', preParsed?: { ops: any[]; unhandled: string[] }) {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  if (!job) throw new Error('Not found');
  const parsed = preParsed ?? await studio.parseRequest(text, {
    lines: (job.analysis?.selection?.lines ?? []).map((l: any, i: number) => `${i + 1}. ${l.text}`),
    takes: (job.analysis?.takes ?? []).map((t: any) => t.take_id),
  });
  // a version picked together with the change ("approve B but ...") narrows the next round to that style
  await q(`INSERT INTO approval_decisions (job_id, revision, decision, by_email, by_user, via, note, ops) VALUES ($1,$2,'changes',$3,$4,$5,$6,$7)`,
    [jobId, job.revision, by.email ?? null, by.userId ?? null, via, text.slice(0, 2000), JSON.stringify(parsed.ops)]);
  const overrides = [...(job.overrides ?? []), ...parsed.ops];
  await q(`UPDATE production_jobs SET overrides=$2, revision=revision+1 WHERE id=$1`, [jobId, JSON.stringify(overrides)]);
  await q(`UPDATE email_threads SET status='answered' WHERE job_id=$1 AND kind='approval' AND status='open'`, [jobId]);
  const note = parsed.ops.length ? `${parsed.ops.length} change(s) understood` : 'No change could be understood automatically';
  await setStatus(jobId, 'planning', `${note}${parsed.unhandled.length ? `; needs a person: "${parsed.unhandled.join(' ').slice(0, 200)}"` : ''}. Making revision ${job.revision + 1}`);
  await audit(by.userId ?? null, 'studio.changes', 'production_job', jobId, { via, by: by.email, ops: parsed.ops, unhandled: parsed.unhandled });
  setImmediate(() => advance(jobId).catch(console.error));
  return parsed;
}

async function stepApproved(job: any) {
  await deliverFinal(job);
  await writeSuggestionsLog(job.id);
  const { schedulePublishing } = await import('./publish.js');
  await schedulePublishing(job);
}

// ---------------------------------------------------------------- email polling
export async function checkEmail() {
  if (!emailReview(await studioSettings())) return;
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return;
  const settings = await studioSettings();
  const approvers = new Set((settings.approver_emails ?? []).map((e: string) => e.toLowerCase()));
  const threads = await q<any>(`SELECT t.*, j.status AS job_status, j.code, j.title FROM email_threads t JOIN production_jobs j ON j.id=t.job_id
                                 WHERE t.status='open' AND t.gmail_thread_id IS NOT NULL ORDER BY t.sent_at LIMIT 40`);
  for (const t of threads) {
    let msgs;
    try { msgs = await gmailThread(t.gmail_thread_id); } catch (e) { console.warn('[studio] gmail read failed', (e as Error).message); continue; }
    await q(`UPDATE email_threads SET last_checked_at=now() WHERE id=$1`, [t.id]);
    const sentAt = new Date(t.sent_at).getTime();
    for (const m of msgs) {
      if (m.fromEmail === ws.email.toLowerCase() || m.date.getTime() <= sentAt) continue;
      const exists = await one(`SELECT 1 FROM email_replies WHERE gmail_message_id=$1`, [m.id]);
      if (exists) continue;
      const rep = await one<any>(`INSERT INTO email_replies (thread_id, gmail_message_id, from_email, body, received_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, m.id, m.fromEmail, m.body.slice(0, 20000), m.date]);
      if (t.kind === 'suggestions' && t.job_status === 'waiting_suggestions') {
        const { strip } = await import('./text.js');
        await recordSuggestion(t.job_id, m.fromEmail, strip(m.body), 'email');
        await q(`UPDATE email_replies SET handled=true WHERE id=$1`, [rep.id]);
        setImmediate(() => advance(t.job_id).catch(console.error));
      }
      if (t.kind === 'approval' && t.job_status === 'in_review') {
        if (!approvers.has(m.fromEmail)) {
          await q(`UPDATE email_replies SET classification=$2 WHERE id=$1`, [rep.id, JSON.stringify({ ignored: 'sender is not on the approvers list' })]);
          continue;
        }
        const c = await studio.classifyReply(m.body);
        await q(`UPDATE email_replies SET classification=$2, handled=true WHERE id=$1`, [rep.id, JSON.stringify(c)]);
        const byLabel = c.version ? await one<any>(`SELECT variant FROM production_versions WHERE job_id=$1 AND label=$2 AND aspect='9:16' ORDER BY revision DESC LIMIT 1`, [t.job_id, c.version]) : null;
        const variant = byLabel?.variant ?? ((c as any).style ? (await one<any>(`SELECT variant FROM production_versions WHERE job_id=$1 AND variant=$2 LIMIT 1`, [t.job_id, (c as any).style]))?.variant ?? null : null);
        if (c.decision === 'approve') await approve(t.job_id, variant, { email: m.fromEmail }, 'email', c.text.slice(0, 500));
        else if (c.decision === 'reject') await reject(t.job_id, { email: m.fromEmail }, 'email', c.text.slice(0, 500));
        else if (c.decision === 'changes') {
          await requestChanges(t.job_id, c.text, { email: m.fromEmail }, 'email', c.ops?.length || c.unhandled?.length ? undefined : undefined);
        } else {
          const mail = clarifyEmail({ code: t.code, title: t.title });
          await gmailSend({ to: [m.fromEmail], ...mail, threadId: t.gmail_thread_id, inReplyTo: t.rfc_message_id }).catch(() => {});
        }
        break; // one decision per check; later replies are handled on the new thread state
      }
    }
  }
}

export async function tick() {
  // suggestion deadlines, stuck steps and email replies
  const waiting = await q<any>(`SELECT id FROM production_jobs WHERE status IN ('new','waiting_suggestions','analyzing','planning','rendering','approved') AND updated_at < now() - interval '20 seconds'`);
  for (const j of waiting) setImmediate(() => advance(j.id).catch(console.error));
  await checkEmail().catch((e) => console.warn('[studio] email check failed', e.message));
  const { runDuePublishing } = await import('./publish.js');
  await runDuePublishing().catch((e) => console.warn('[studio] publishing failed', e.message));
  const { scanDrive, scanSuggestions } = await import('./intake.js');
  await scanDrive().catch((e) => console.warn('[studio] drive scan failed', e.message));
  await scanSuggestions().catch((e) => console.warn('[studio] suggestions scan failed', e.message));
  // finals approved while Drive was not connected (or whose upload failed) are sent to content_final, at most every 10 minutes
  if (Date.now() - lastFinalSync > 10 * 60_000) {
    lastFinalSync = Date.now();
    const r = await syncFinalsToDrive().catch((e) => { console.warn('[studio] final sync failed', e.message); return null; });
    if (r?.sent.length) console.log(`[studio] sent to Google Drive › content_final: ${r.sent.join(', ')}`);
  }
}
let lastFinalSync = 0;

export function fileUrl(p: string) { return pathToFileURL(p).toString(); }
export { driveMove };
