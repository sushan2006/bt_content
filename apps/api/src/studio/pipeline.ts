/**
 * Content Studio (Phase 4): videos are edited by Claude Code from a prompt copied in the dashboard.
 *
 *   prompt_ready ──(Copy prompt)──> with_claude ──(final video found in content_final, or uploaded)──> completed
 *   completed ──(Publish)──> publishing ──> published            cancelled at any point before publishing
 *
 * The dashboard keeps the material (takes, voiceover, pictures, machine photos) in Google Drive so Claude can reach it,
 * writes the prompt, watches Drive › content_final for the finished video and its captions file, and publishes it.
 * Nothing is edited or rendered here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mediaDir } from '../config.js';
import { one, q } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { currentFolders, driveCreateFolder, driveDownload, driveList, driveReadText, driveUpload, driveWriteText, getWorkspace, isDriveId,
  driveThumbnail, workspaceToken, type DriveFile } from '../integrations/workspace.js';
import { buildPrompt, captionsName, finalName, isThumbnailName, jobCodeFromName, parseCaptions, thumbnailName, type PromptContext } from './handoff.js';
import { styleTemplate } from './templates.js';
import { toJpeg, videoFrame } from './thumbs.js';
import { LEGACY_STYLES } from './presets.js';
import { learningsFor } from './learnings.js';
import { learningLine } from '../intelligence/learnings.js';
import { isValidStyle, presetFor } from './styles.js';

export const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
export const OPEN_STATUSES = ['prompt_ready', 'with_claude'];

export async function studioSettings(): Promise<any> {
  return (await one<any>(`SELECT value FROM app_settings WHERE key='studio'`))?.value ?? {};
}

export function jobDir(code: string) {
  const d = path.join(mediaDir, 'studio', code);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** A link Claude Code can open (a Google Drive link), never a path on this computer. */
export const webLink = (l?: string | null) => (l && /^https?:\/\//i.test(l) ? l : null);
const driveLink = (f: DriveFile) => f.webViewLink ?? (isDriveId(f.id) ? `https://drive.google.com/file/d/${f.id}/view` : null);
const safeFile = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);

async function workspace() {
  const ws = await getWorkspace().catch(() => null);
  if (!ws || ws.status !== 'connected') return null;
  return { ws, token: await workspaceToken(ws), folders: await currentFolders(ws), google: !ws.local };
}

// ---------------------------------------------------------------- create
export interface NewJob {
  title: string; brief: any; kind: 'footage' | 'voiceover' | 'animation'; style: string; options: any; platforms?: string[];
  musicTrackId?: string | null; publishAt?: string | null; userId?: string | null; origin?: 'live' | 'demo'; machineIds?: string[];
  source?: 'upload' | 'drive' | 'content_final'; driveFolderId?: string | null; status?: string;
}

export async function createJob(o: NewJob) {
  const settings = await studioSettings();
  const style = isValidStyle(o.style) ? o.style : (settings.default_style ?? 'paper_cutout');
  const item = await one<any>(`INSERT INTO content_items (title, description, owner_id, data_origin, tags) VALUES ($1,$2,$3,$4,'{studio}') RETURNING id, code`,
    [o.title, o.brief?.topic ?? o.brief?.notes ?? null, o.userId ?? null, o.origin ?? 'live']);
  const job = await one<any>(
    `INSERT INTO production_jobs (content_item_id, title, brief, kind, options, source, drive_folder_id, platforms, music_track_id, publish_at, created_by, data_origin, styles, machine_ids, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid[],$15) RETURNING *`,
    [item.id, o.title, JSON.stringify(o.brief ?? {}), o.kind, JSON.stringify(o.options ?? {}), o.source ?? 'upload', o.driveFolderId ?? null,
     o.platforms ?? settings.default_platforms ?? ['instagram', 'facebook', 'youtube'], o.musicTrackId ?? null, o.publishAt ?? null, o.userId ?? null,
     o.origin ?? 'live', [style], [...new Set(o.machineIds ?? [])], o.status ?? 'prompt_ready']);
  return job;
}

export async function addFile(jobId: string, f: { kind: string; name: string; storage_path: string; take_id?: string | null; drive_file_id?: string | null; drive_link?: string | null;
  md5?: string | null; size?: number; tags?: string[] }) {
  return one<any>(
    `INSERT INTO production_files (job_id, kind, take_id, name, storage_path, drive_file_id, drive_link, md5, size_bytes, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (job_id, storage_path) DO UPDATE SET name=EXCLUDED.name, tags=EXCLUDED.tags RETURNING *`,
    [jobId, f.kind, f.take_id ?? null, f.name, f.storage_path, f.drive_file_id ?? null, f.drive_link ?? null, f.md5 ?? null, f.size ?? null, f.tags ?? []]);
}

// ---------------------------------------------------------------- Drive: the material Claude needs
/** The job's folder in content_midway ("JOB-012 Title"), created on first use. */
export async function jobFolder(job: any) {
  const w = await workspace();
  if (!w) return null;
  let folder = job.drive_midway_folder as string | null;
  if (!folder || (w.google !== isDriveId(folder))) {
    folder = await driveCreateFolder(`${job.code} ${job.title}`.slice(0, 120), w.folders.midway, w.token);
    await q(`UPDATE production_jobs SET drive_midway_folder=$2 WHERE id=$1`, [job.id, folder]);
    job.drive_midway_folder = folder;
  }
  return { ...w, folder };
}

/** Uploads the takes, voiceover and pictures of a job to its Drive folder. With Google Drive the copy on this computer is then removed. */
export async function uploadJobFiles(jobId: string): Promise<{ uploaded: number; error?: string }> {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  if (!job || job.data_origin === 'demo') return { uploaded: 0 };
  const files = await q<any>(`SELECT * FROM production_files WHERE job_id=$1 AND kind IN ('take','image','voiceover') ORDER BY created_at`, [jobId]);
  let uploaded = 0;
  try {
    const d = await jobFolder(job);
    if (!d) return { uploaded: 0, error: 'Google Drive is not connected' };
    for (const f of files) {
      const done = f.drive_file_id && (d.google ? isDriveId(f.drive_file_id) : !isDriveId(f.drive_file_id));
      if (done || !fs.existsSync(f.storage_path)) continue;
      const name = f.kind === 'take' ? `${f.take_id} ${f.name}` : f.kind === 'voiceover' ? `voiceover ${f.name}` : f.name;
      const mime = f.kind === 'image' ? (/\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg') : f.kind === 'voiceover' ? 'audio/mpeg' : 'video/mp4';
      const up = await driveUpload(f.storage_path, safeFile(name), d.folder, d.token, mime);
      await q(`UPDATE production_files SET drive_file_id=$2, drive_link=$3 WHERE id=$1`, [f.id, up.id, driveLink(up)]);
      uploaded++;
      if (d.google && (await studioSettings()).storage_mode !== 'local') { try { fs.unlinkSync(f.storage_path); } catch { /* in use: kept */ } }
    }
    await q(`UPDATE production_jobs SET final_error=NULL WHERE id=$1 AND final_error LIKE 'Upload to Drive%'`, [jobId]);
    return { uploaded };
  } catch (e) {
    const error = `Upload to Drive failed: ${(e as Error).message}`.slice(0, 500);
    console.warn(`[studio ${job.code}] ${error}`);
    return { uploaded, error };
  }
}

/** Photos of a machine go to Drive › _assets › machines › <name>, so Claude can see them. */
export async function uploadMachinePhotos(machineId: string) {
  const m = await one<any>('SELECT * FROM machines WHERE id=$1', [machineId]);
  const w = await workspace();
  if (!m || !w) return;
  const folder = await driveCreateFolder(safeFile(m.name), w.folders.machines, w.token);
  const links: string[] = [];
  for (const p of m.photos ?? []) {
    if (!fs.existsSync(p)) continue;
    const up = await driveUpload(p, path.basename(p).replace(/^\d+_/, ''), folder, w.token, /\.png$/i.test(p) ? 'image/png' : 'image/jpeg');
    const l = webLink(driveLink(up));
    if (l) links.push(l);
  }
  await q(`UPDATE machines SET photo_links=$2, updated_at=now() WHERE id=$1`, [machineId, links]);
}

/** Uploads a reference video to Drive › _assets › style_references (Claude watches it there). */
export async function uploadReference(profileId: string) {
  const p = await one<any>('SELECT * FROM style_profiles WHERE id=$1', [profileId]);
  const w = await workspace();
  if (!p || !w || !p.source_path || !fs.existsSync(p.source_path)) return;
  const up = await driveUpload(p.source_path, safeFile(`${p.name} — ${p.source_name ?? 'reference'}`), w.folders.references, w.token, 'video/mp4');
  await q(`UPDATE style_profiles SET drive_file_id=$2, drive_link=$3, updated_at=now() WHERE id=$1`, [profileId, up.id, driveLink(up)]);
}

/** The logo goes to Drive › _assets › brand_kit. */
export async function uploadLogo(localPath: string): Promise<string | null> {
  const w = await workspace();
  if (!w) return null;
  const up = await driveUpload(localPath, `logo${path.extname(localPath) || '.png'}`, w.folders.brand, w.token, /\.jpe?g$/i.test(localPath) ? 'image/jpeg' : 'image/png');
  return webLink(driveLink(up));
}

/** Licensed music goes to Drive › _assets › music_licensed. */
export async function uploadMusic(trackId: string) {
  const t = await one<any>('SELECT * FROM music_tracks WHERE id=$1', [trackId]);
  const w = await workspace();
  if (!t || !w || !fs.existsSync(t.storage_path)) return;
  const up = await driveUpload(t.storage_path, safeFile(`${t.title}${t.artist ? ` - ${t.artist}` : ''}${path.extname(t.storage_path)}`), w.folders.music, w.token, 'audio/mpeg');
  await q(`UPDATE music_tracks SET drive_link=$2 WHERE id=$1`, [trackId, webLink(driveLink(up))]);
}

// ---------------------------------------------------------------- the prompt
export async function promptContext(jobId: string): Promise<PromptContext> {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  if (!job) throw new Error('Not found');
  const settings = await studioSettings();
  const brand = settings.brand ?? {};
  const files = await q<any>(`SELECT * FROM production_files WHERE job_id=$1 ORDER BY kind, take_id, created_at`, [jobId]);
  const key = job.styles?.[0] ?? null;
  let reference = null;
  if (key?.startsWith('profile:')) {
    const p = await one<any>('SELECT * FROM style_profiles WHERE id=$1', [key.slice(8)]);
    if (p) reference = { name: p.name, summary: p.summary, report: p.report ?? [], notes: p.notes, link: webLink(p.drive_link) };
  }
  const machines = (job.machine_ids ?? []).length
    ? await q<any>(`SELECT name, notes, keywords, photo_links FROM machines WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`, [job.machine_ids]) : [];
  const music = job.music_track_id ? await one<any>(`SELECT * FROM music_tracks WHERE id=$1`, [job.music_track_id]) : null;
  const sugg = await q<any>(`SELECT from_email, text FROM production_suggestions WHERE job_id=$1 AND NOT is_none ORDER BY received_at`, [jobId]);
  const lessons = await learningsFor(job.data_origin === 'demo' ? 'demo' : 'live', { style: key, platforms: job.platforms ?? [] }).catch(() => null);
  const ws = await getWorkspace().catch(() => null);
  const folders = ws?.status === 'connected' ? await currentFolders(ws).catch(() => null) : null;
  const finalLink = ws && !ws.local && folders?.final ? `https://drive.google.com/drive/folders/${folders.final}` : null;
  const folderLink = job.drive_midway_folder && isDriveId(job.drive_midway_folder) ? `https://drive.google.com/drive/folders/${job.drive_midway_folder}` : null;
  const ref = (f: any) => ({ name: f.name, link: webLink(f.drive_link), size: f.size_bytes ? Number(f.size_bytes) : null, tags: f.tags, take_id: f.take_id });
  const voice = files.find((f) => f.kind === 'voiceover');
  return {
    job: { code: job.code, title: job.title, kind: job.kind, options: job.options ?? {}, platforms: job.platforms ?? [], brief: job.brief ?? {}, publish_at: job.publish_at },
    style: { preset: key ? presetFor(key) : null, reference, legacy: key && !presetFor(key) && !reference ? LEGACY_STYLES[key] ?? key : null },
    brand: { company_name: brand.company_name, handle: brand.handle, tagline: brand.tagline, cta: brand.cta, colors: brand.colors, logo_link: webLink(brand.logo_drive_link) },
    glossary: settings.glossary ?? [],
    takes: files.filter((f) => f.kind === 'take').map(ref),
    images: files.filter((f) => f.kind === 'image').map(ref),
    voiceover: voice ? ref(voice) : null,
    machines: machines.map((m) => ({ name: m.name, notes: m.notes, keywords: m.keywords ?? [], photo_links: m.photo_links ?? [] })),
    music: music && job.options?.music ? { title: music.title, artist: music.artist, source: music.source?.replace(/_/g, ' '), link: webLink(music.drive_link), license: music.license_note } : null,
    suggestions: sugg.map((s) => ({ from: s.from_email.replace(/@drive$/, ' (Drive)'), text: s.text })),
    findings: (lessons?.items ?? []).filter((i) => i.for_claude).map((i) => learningLine(i)),
    final_folder: { where: ws?.local ? "content_final (the dashboard's local folder: Google Drive is not connected)" : 'content_final', link: finalLink },
    job_folder_link: folderLink,
    template: key && presetFor(key) ? styleTemplate(key) : null,
  };
}

export async function jobPrompt(jobId: string) {
  return buildPrompt(await promptContext(jobId));
}

/** Copying the prompt hands the video to Claude. Copying again (e.g. after new suggestions) only counts. */
export async function promptCopied(jobId: string, userId: string | null) {
  const job = await one<any>(`UPDATE production_jobs SET prompt_copied_at=now(), prompt_copies=prompt_copies+1,
      status=CASE WHEN status='prompt_ready' THEN 'with_claude' ELSE status END,
      status_detail=CASE WHEN status IN ('prompt_ready','with_claude') THEN 'Being edited in Claude Code' ELSE status_detail END, updated_at=now()
    WHERE id=$1 RETURNING id, status, prompt_copies`, [jobId]);
  await audit(userId, 'studio.prompt.copy', 'production_job', jobId, { copies: job?.prompt_copies });
  return job;
}

// ---------------------------------------------------------------- the finished video
/** Links a finished video to its job: the job becomes Completed. */
export async function attachFinal(job: any, f: { id: string; name: string; link?: string | null; size?: number | null; local_path?: string | null; source: 'drive' | 'upload' }) {
  await q(`UPDATE production_jobs SET final_drive_file_id=$2, final_drive_link=$3, final_name=$4, final_size=$5, final_path=coalesce($6, final_path), final_source=$7, final_error=NULL,
             completed_at=coalesce(completed_at, now()), status=CASE WHEN status IN ('prompt_ready','with_claude','completed') THEN 'completed' ELSE status END,
             status_detail=CASE WHEN status IN ('prompt_ready','with_claude','completed') THEN 'Ready to publish' ELSE status_detail END, updated_at=now()
           WHERE id=$1`, [job.id, f.id, f.link ?? null, f.name, f.size ?? null, f.local_path ?? null, f.source]);
  // remembered, so a file that was replaced or set aside is never picked up again
  await addFile(job.id, { kind: 'final', name: f.name, storage_path: f.id, drive_file_id: f.id, drive_link: f.link ?? null, size: f.size ?? undefined });
  console.log(`[studio ${job.code}] finished video found: ${f.name}`);
}

async function readCaptions(job: any, file: DriveFile, token: string) {
  const text = await driveReadText(file.id, token, file.mimeType).catch(() => '');
  if (!text.trim()) return;
  await q(`UPDATE production_jobs SET final_captions=$2, final_captions_file_id=$3, updated_at=now() WHERE id=$1`, [job.id, JSON.stringify(parseCaptions(text)), file.id]);
}

const isText = (f: DriveFile) => /\.(txt|md)$/i.test(f.name) || f.mimeType === 'application/vnd.google-apps.document';
let lastFinalScan = 0;
/**
 * Looks in content_final. A video whose name starts with a job code ("JOB-012 …") completes that job; any other video
 * becomes a new completed video, so everything in content_final shows up in the dashboard. "<JOB> captions.txt" next
 * to it fills in the captions for publishing.
 */
export async function scanFinals(force = false): Promise<{ scanned: boolean; linked: string[]; imported: string[]; error?: string }> {
  const out = { scanned: false, linked: [] as string[], imported: [] as string[] };
  const settings = await studioSettings();
  const every = Math.max(1, Number(settings.drive_scan_minutes ?? 5)) * 60_000;
  if (!force && Date.now() - lastFinalScan < every) return out;
  lastFinalScan = Date.now();
  const w = await workspace().catch((e) => { throw new Error(`Google Drive: ${(e as Error).message}`); });
  if (!w) return { ...out, error: 'Google Drive is not connected' };
  const files = await driveList(w.folders.final, w.token);
  const settle = Number(settings.drive_settle_seconds ?? (w.google ? 60 : 5)) * 1000;
  for (const f of files) {
    if (!(VIDEO_EXT.test(f.name) || f.mimeType.startsWith('video/'))) continue;
    if (await one(`SELECT 1 FROM production_files WHERE kind='final' AND storage_path=$1 UNION ALL SELECT 1 FROM production_jobs WHERE final_drive_file_id=$1`, [f.id])) continue;
    if (f.modifiedTime && Date.now() - new Date(f.modifiedTime).getTime() < settle) continue;   // still uploading
    const code = jobCodeFromName(f.name);
    let job = code ? await one<any>(`SELECT * FROM production_jobs WHERE upper(code)=$1 AND data_origin='live'`, [code]) : null;
    const meta = { id: f.id, name: f.name, link: w.google ? driveLink(f) : null, size: f.size ? Number(f.size) : null, local_path: w.google ? null : f.id, source: 'drive' as const };
    if (job && (!job.final_drive_file_id || ['prompt_ready', 'with_claude', 'completed'].includes(job.status))) {
      await attachFinal(job, meta);
      out.linked.push(job.code);
    } else if (!job) {
      const title = f.name.replace(/\.[^.]+$/, '').replace(/^\s*job[\s_-]?\d+\s*/i, '').replace(/[_]+/g, ' ').trim() || 'Video from content_final';
      job = await createJob({ title, brief: {}, kind: 'footage', style: settings.default_style ?? 'paper_cutout', options: {}, source: 'content_final', status: 'completed' });
      await attachFinal(job, meta);
      out.imported.push(`${job.code} ${title}`);
    } else continue;
    const cap = files.find((x) => isText(x) && /caption/i.test(x.name) && jobCodeFromName(x.name) === job.code);
    if (cap) await readCaptions(job, cap, w.token);
    const thumb = files.find((x) => isThumbnailName(x.name) && jobCodeFromName(x.name) === job.code);
    if (thumb) await takeDriveThumbnail(job, thumb, w.token).catch((e) => console.warn(`[studio ${job.code}] thumbnail: ${(e as Error).message}`));
    else queueAutoThumbnail(job.id);
  }
  // thumbnails that arrive after their video (or replace the earlier one)
  for (const f of files.filter((x) => isThumbnailName(x.name))) {
    const code = jobCodeFromName(f.name);
    if (!code || await one(`SELECT 1 FROM production_files WHERE kind='thumbnail' AND storage_path=$1`, [f.id])) continue;
    if (f.modifiedTime && Date.now() - new Date(f.modifiedTime).getTime() < settle) continue;
    const job = await one<any>(`SELECT * FROM production_jobs WHERE upper(code)=$1 AND data_origin='live' AND final_drive_file_id IS NOT NULL`, [code]);
    if (job) await takeDriveThumbnail(job, f, w.token).catch((e) => console.warn(`[studio ${job.code}] thumbnail: ${(e as Error).message}`));
  }
  // captions files that arrive after their video
  for (const f of files.filter((x) => isText(x) && /caption/i.test(x.name))) {
    const code = jobCodeFromName(f.name);
    if (!code) continue;
    const job = await one<any>(`SELECT * FROM production_jobs WHERE upper(code)=$1 AND data_origin='live' AND final_drive_file_id IS NOT NULL
                                  AND (final_captions_file_id IS DISTINCT FROM $2)`, [code, f.id]);
    if (job) await readCaptions(job, f, w.token);
  }
  await q(`UPDATE workspace_connections SET last_scan_at=now() WHERE id=$1`, [w.ws.id]).catch(() => {});
  return { ...out, scanned: true };
}

/** "Upload final video" on the video page: the file goes to content_final and completes the job. */
export async function uploadFinal(job: any, localPath: string, originalName: string, captionsText?: string | null) {
  const ext = path.extname(originalName) || '.mp4';
  const name = finalName(job.code, job.title, ext.toLowerCase());
  const w = await workspace();
  let meta: Parameters<typeof attachFinal>[1] = { id: localPath, name, size: fs.statSync(localPath).size, local_path: localPath, source: 'upload', link: null };
  if (w) {
    const up = await driveUpload(localPath, name, w.folders.final, w.token, 'video/mp4');
    meta = { ...meta, id: up.id, link: w.google ? driveLink(up) : null, local_path: localPath };
    if (captionsText?.trim()) await driveWriteText(captionsName(job.code), captionsText, w.folders.final, w.token).catch(() => null);
  } else {
    await q(`UPDATE production_jobs SET final_error=$2 WHERE id=$1`, [job.id, 'Google Drive is not connected: the final video is kept on this computer only.']);
  }
  await attachFinal(job, meta);
  if (captionsText?.trim()) await q(`UPDATE production_jobs SET final_captions=$2 WHERE id=$1`, [job.id, JSON.stringify(parseCaptions(captionsText))]);
  // the video is on this computer now: its automatic thumbnail is made straight away (a better one can replace it)
  const fresh = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [job.id]);
  if (!fresh.thumbnail_path || fresh.thumbnail_source === 'auto') await autoThumbnail(fresh).catch((e) => console.warn(`[studio ${job.code}] thumbnail: ${(e as Error).message}`));
}

// ---------------------------------------------------------------- thumbnails
/**
 * Sets the video's thumbnail from a JPEG on this computer. Unless it came from Drive already (Claude's file), a copy
 * goes to content_final as "<JOB> thumbnail.jpg", so Drive has it too. Every thumbnail file is remembered.
 */
export async function setThumbnail(job: any, jpeg: string, source: 'claude' | 'upload' | 'frame' | 'auto', o: { time?: number | null; driveId?: string | null } = {}) {
  const dest = path.join(jobDir(job.code), `thumbnail_${Date.now()}.jpg`);
  fs.copyFileSync(jpeg, dest);
  let driveId = o.driveId ?? null;
  if (!driveId && job.data_origin !== 'demo') {
    const w = await workspace().catch(() => null);
    if (w) {
      try { driveId = (await driveUpload(dest, thumbnailName(job.code), w.folders.final, w.token, 'image/jpeg')).id; }
      catch (e) { console.warn(`[studio ${job.code}] thumbnail to Drive: ${(e as Error).message}`); }
    }
  }
  if (driveId) await addFile(job.id, { kind: 'thumbnail', name: thumbnailName(job.code), storage_path: driveId, drive_file_id: driveId });
  const old = job.thumbnail_path as string | null;
  await q(`UPDATE production_jobs SET thumbnail_path=$2, thumbnail_drive_id=$3, thumbnail_source=$4, thumbnail_time=$5, thumbnail_updated_at=now(), updated_at=now() WHERE id=$1`,
    [job.id, dest, driveId, source, o.time ?? null]);
  if (old && old !== dest && old.startsWith(jobDir(job.code))) { try { fs.unlinkSync(old); } catch { /* still shown somewhere: kept */ } }
}

/** Claude's (or anyone's) "<JOB> thumbnail.jpg" in content_final. */
async function takeDriveThumbnail(job: any, f: DriveFile, token: string) {
  if (await one(`SELECT 1 FROM production_files WHERE kind='thumbnail' AND storage_path=$1`, [f.id])) return;
  const raw = path.join(jobDir(job.code), `incoming_${Date.now()}${path.extname(f.name) || '.jpg'}`);
  await driveDownload(f.id, raw, token);
  const jpg = `${raw}.jpg`;
  try { await toJpeg(raw, jpg); await setThumbnail(job, jpg, 'claude', { driveId: f.id }); }
  finally { for (const x of [raw, jpg]) { try { fs.unlinkSync(x); } catch { /* gone */ } } }
}

/** A frame of the finished video: the automatic thumbnail, or the one picked on the video page. */
export async function frameThumbnail(job: any, at: number | null, source: 'frame' | 'auto') {
  const file = await ensureFinalLocal(job);
  if (!file) throw new Error('The finished video is not available to take a frame from');
  const tmp = path.join(jobDir(job.code), `frame_${Date.now()}.jpg`);
  try {
    const { time } = await videoFrame(file, tmp, at);
    await setThumbnail(job, tmp, source, { time });
  } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
}

export async function autoThumbnail(job: any) {
  if (job.thumbnail_path && fs.existsSync(job.thumbnail_path) && job.thumbnail_source !== 'auto') return;
  await frameThumbnail(job, null, 'auto');
}

const autoQueue = new Set<string>();
/** Finished videos without a thumbnail get one in the background (the video may first have to come from Drive). */
export function queueAutoThumbnail(jobId: string) {
  if (autoQueue.has(jobId)) return;
  autoQueue.add(jobId);
  setImmediate(async () => {
    try {
      const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
      if (job && !(job.thumbnail_path && fs.existsSync(job.thumbnail_path))) await autoThumbnail(job);
    } catch (e) { console.warn(`[studio] automatic thumbnail failed: ${(e as Error).message}`); }
    finally { autoQueue.delete(jobId); }
  });
}

/** A frame of a raw take, shown with the material. From the file when it is here, otherwise Drive's own preview. */
export async function takeThumbnail(fileId: string, opts: { driveFile?: DriveFile; token?: string } = {}) {
  const f = await one<any>(`SELECT f.*, j.code FROM production_files f JOIN production_jobs j ON j.id=f.job_id WHERE f.id=$1`, [fileId]);
  if (!f || f.kind !== 'take') return;
  const dest = path.join(jobDir(f.code), 'thumbs', `${f.take_id ?? f.id}.jpg`);
  let ok = false;
  if (fs.existsSync(f.storage_path)) ok = !!(await videoFrame(f.storage_path, dest).catch(() => null));
  else if (opts.driveFile && opts.token) ok = await driveThumbnail(opts.driveFile, dest, opts.token).catch(() => false);
  if (ok) await q(`UPDATE production_files SET thumb_path=$2 WHERE id=$1`, [f.id, dest]);
}

/** The picture that stands for a video: its thumbnail, or a frame of its first take while it is being made. */
export async function coverPath(job: any): Promise<string | null> {
  if (job.thumbnail_path && fs.existsSync(job.thumbnail_path)) return job.thumbnail_path;
  const t = await one<any>(`SELECT thumb_path FROM production_files WHERE job_id=$1 AND kind='take' AND thumb_path IS NOT NULL ORDER BY take_id LIMIT 1`, [job.id]);
  return t?.thumb_path && fs.existsSync(t.thumb_path) ? t.thumb_path : null;
}

/** The finished video as a file on this computer (downloaded from Google Drive when needed), for publishing. */
export async function ensureFinalLocal(job: any): Promise<string | null> {
  if (job.final_path && fs.existsSync(job.final_path)) return job.final_path;
  const src = job.final_drive_file_id as string | null;
  if (!src) return null;
  if (!isDriveId(src)) return fs.existsSync(src) ? src : null;
  const w = await workspace();
  if (!w?.google) return null;
  const dest = path.join(jobDir(job.code), 'final', safeFile(job.final_name ?? `${job.code}.mp4`));
  await driveDownload(src, dest, w.token);
  await q(`UPDATE production_jobs SET final_path=$2 WHERE id=$1`, [job.id, dest]);
  return dest;
}

// ---------------------------------------------------------------- suggestions
export async function recordSuggestion(jobId: string, fromEmail: string, text: string, source: 'app' | 'drive') {
  const isNone = /^\s*(none|no|nope|no suggestions?|nothing|all good|nothing from me|no changes)\b[\s.!]*$/i.test(text.trim().split('\n')[0]);
  const row = await one<any>(`INSERT INTO production_suggestions (job_id, from_email, text, is_none, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [jobId, fromEmail.toLowerCase(), text.slice(0, 4000), isNone, source]);
  setImmediate(() => writeSuggestionsLog(jobId).catch(() => {}));
  return row;
}

/** suggestions/<JOB> – suggestions log.txt: every suggestion, so the team sees them in Drive too. */
export async function writeSuggestionsLog(jobId: string) {
  const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [jobId]);
  const w = await workspace().catch(() => null);
  if (!job || !w || job.data_origin === 'demo') return;
  const sugg = await q<any>(`SELECT * FROM production_suggestions WHERE job_id=$1 ORDER BY received_at`, [jobId]);
  const lines = [`${job.code} — ${job.title}`, '', sugg.length ? 'Suggestions (they are included in the prompt for Claude):' : 'No suggestions yet.',
    ...sugg.map((x, i) => `${i + 1}. ${x.from_email} (${x.source}, ${new Date(x.received_at).toLocaleString('en-IN')}): ${x.text.replace(/\s+/g, ' ').slice(0, 600)}`),
    '', 'To add one, put a text file in this folder named like:', `   ${job.code} from <your name>.txt`];
  await driveWriteText(`${job.code} – suggestions log.txt`, lines.join('\n'), w.folders.suggestions, w.token);
}

// ---------------------------------------------------------------- background work (every minute)
export async function tick() {
  const { runDuePublishing } = await import('./publish.js');
  await runDuePublishing().catch((e) => console.warn('[studio] publishing failed', e.message));
  const { scanDrive, scanSuggestions } = await import('./intake.js');
  await scanDrive().catch((e) => console.warn('[studio] content_raw scan failed', e.message));
  await scanSuggestions().catch((e) => console.warn('[studio] suggestions scan failed', e.message));
  const r = await scanFinals().catch((e) => { console.warn('[studio] content_final scan failed', e.message); return null; });
  if (r?.linked.length || r?.imported.length) console.log(`[studio] content_final: completed ${[...r.linked, ...r.imported].join(', ')}`);
  // material that could not be uploaded yet (Drive was not connected)
  const pending = await q<any>(`SELECT DISTINCT f.job_id FROM production_files f JOIN production_jobs j ON j.id=f.job_id
                                 WHERE f.kind IN ('take','image','voiceover') AND f.drive_file_id IS NULL AND j.status IN ('prompt_ready','with_claude') AND j.data_origin='live' LIMIT 5`);
  for (const p of pending) await uploadJobFiles(p.job_id);
  await backfillDrive().catch((e) => console.warn('[studio] Drive backfill failed', e.message));
  const noThumb = await q<any>(`SELECT id FROM production_jobs WHERE status IN ('completed','publishing','published') AND (final_drive_file_id IS NOT NULL OR final_path IS NOT NULL)
                                  AND thumbnail_path IS NULL ORDER BY completed_at DESC NULLS LAST LIMIT 2`);
  for (const j of noThumb) queueAutoThumbnail(j.id);
}

const backfilled = new Set<string>();
/** Logo, reference videos, machine photos and music added before Google Drive was connected (or before this version) go to Drive once, so the prompt can link them. */
async function backfillDrive() {
  const ws = await getWorkspace().catch(() => null);
  if (!ws || ws.local || ws.status !== 'connected') return;
  const once = async (key: string, fn: () => Promise<unknown>) => { if (backfilled.has(key)) return; backfilled.add(key); await fn().catch((e) => console.warn(`[studio] ${key}: ${(e as Error).message}`)); };
  const settings = await studioSettings();
  const logo = settings.brand?.logo_path;
  if (logo && fs.existsSync(logo) && !settings.brand?.logo_drive_link) {
    await once('logo', async () => {
      const link = await uploadLogo(logo);
      if (link) await q(`UPDATE app_settings SET value = jsonb_set(value, '{brand,logo_drive_link}', to_jsonb($1::text)), updated_at=now() WHERE key='studio'`, [link]);
    });
  }
  for (const r of await q<any>(`SELECT id FROM style_profiles WHERE drive_file_id IS NULL AND source_path IS NOT NULL LIMIT 5`)) await once(`ref:${r.id}`, () => uploadReference(r.id));
  for (const m of await q<any>(`SELECT id FROM machines WHERE cardinality(photo_links) = 0 AND cardinality(photos) > 0 LIMIT 5`)) await once(`machine:${m.id}`, () => uploadMachinePhotos(m.id));
  for (const t of await q<any>(`SELECT id FROM music_tracks WHERE drive_link IS NULL AND is_active LIMIT 5`)) await once(`music:${t.id}`, () => uploadMusic(t.id));
}

