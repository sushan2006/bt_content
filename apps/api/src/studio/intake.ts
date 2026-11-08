/**
 * Google Drive intake.
 * Convention: one sub-folder in "content_raw" per video, e.g. "Water motor". Inside it:
 *   - the takes (any video files; sorted by name -> T1, T2, T3) or a voiceover (mp3 / wav / m4a)
 *   - optional brief.txt (or a Google Doc named "brief"): "Title:", "About:", "Style:", "Length:", "Format:", "Speaker:", "CTA:" ...
 *   - optional script.txt and pictures (jpg/png; words in the file name say when to show them)
 * A folder becomes a video once nothing in it has changed for a few minutes (uploads finished). Nothing is downloaded:
 * the files stay in Drive and their links go into the prompt. The folder is moved to content_midway as "<JOB> <title>".
 */
import { one, q } from '../db/pool.js';
import { currentFolders, driveCreateFolder, driveList, driveMove, driveReadText, getWorkspace, isDriveId, localScanDue, workspaceToken } from '../integrations/workspace.js';
import { PRESETS } from './presets.js';
import { addFile, createJob, recordSuggestion, studioSettings, takeThumbnail } from './pipeline.js';

const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;

export function parseBrief(text: string): any {
  const brief: any = {};
  const free: string[] = [];
  const keys: Record<string, string> = { title: 'title', about: 'topic', topic: 'topic', headline: 'headline', speaker: 'speaker_name', name: 'speaker_name', role: 'speaker_role',
    cta: 'cta', 'call to action': 'cta', keywords: 'keywords', hashtags: 'hashtags', notes: 'notes', platforms: 'platforms', 'publish at': 'publish_at', script: 'script',
    styles: 'style', style: 'style', length: 'length', format: 'format', machine: 'machine', spellings: 'spellings', spelling: 'spellings' };
  let inScript = false;
  const script: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Za-z ]{3,20})\s*:\s*(.*)$/);
    const key = m ? keys[m[1].trim().toLowerCase()] : undefined;
    if (key === 'script') { inScript = true; if (m![2]) script.push(m![2]); continue; }
    if (key) {
      inScript = false;
      const v = m![2].trim();
      brief[key] = ['keywords', 'hashtags', 'platforms'].includes(key) ? v.split(/[,;]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : v;
    } else if (inScript) script.push(ln);
    else if (ln.trim()) free.push(ln.trim());
  }
  if (script.length) brief.script = script.join('\n').trim();
  if (free.length && !brief.notes) brief.notes = free.join(' ');
  return brief;
}

/** "Paper cut-out", "paper_cutout", "1" -> paper_cutout */
export function styleFromText(s?: string | null): string | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const p = PRESETS.find((x) => x.key.replace(/_/g, '') === t || x.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === t || String(x.number) === t);
  return p?.key ?? null;
}

/** "45", "45s", "0:45", "1 min" -> seconds */
export function lengthFromText(s?: string | null): number | null {
  if (!s) return null;
  const mm = s.match(/(\d+):(\d{1,2})/);
  if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return /min/i.test(s) ? Math.round(n * 60) : Math.round(n);
}

export async function scanDrive(force = false) {
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return { scanned: false, reason: 'not connected' };
  const settings = await studioSettings();
  if (ws.local) {
    if (!force && !localScanDue(Number(settings.local_scan_seconds ?? 30) * 1000)) return { scanned: false, reason: 'recently scanned' };
  } else {
    const last = await one<any>('SELECT last_scan_at FROM workspace_connections WHERE id=$1', [ws.id]);
    const every = Number(settings.drive_scan_minutes ?? 5) * 60_000;
    if (!force && last?.last_scan_at && Date.now() - new Date(last.last_scan_at).getTime() < every) return { scanned: false, reason: 'recently scanned' };
  }
  const folders = await currentFolders(ws);
  const token = await workspaceToken(ws);
  const settle = Number(settings.drive_settle_seconds ?? (ws.local ? 20 : 180)) * 1000;
  const entries = await driveList(folders.raw, token);
  const created: string[] = [];
  const link = (f: any) => (ws.local ? null : f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`);
  for (const folder of entries.filter((e) => e.mimeType === 'application/vnd.google-apps.folder')) {
    if (await one(`SELECT 1 FROM production_jobs WHERE drive_folder_id=$1`, [folder.id])) continue;
    const files = await driveList(folder.id, token);
    const takes = files.filter((f) => VIDEO.test(f.name) || f.mimeType.startsWith('video/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const voice = files.find((f) => AUDIO.test(f.name) || f.mimeType.startsWith('audio/'));
    const briefFile = files.find((f) => /^brief(\.txt|\.md)?$/i.test(f.name) || (f.mimeType === 'application/vnd.google-apps.document' && /brief/i.test(f.name)));
    if (!takes.length && !voice && !briefFile) continue;
    const newest = Math.max(...files.map((f) => new Date(f.modifiedTime ?? 0).getTime()));
    if (Date.now() - newest < settle) continue; // still uploading
    const scriptFile = files.find((f) => /^script(\.txt|\.md)?$/i.test(f.name) || (f.mimeType === 'application/vnd.google-apps.document' && /script/i.test(f.name)));
    const brief = briefFile ? parseBrief(await driveReadText(briefFile.id, token, briefFile.mimeType)) : {};
    if (scriptFile) brief.script = (await driveReadText(scriptFile.id, token, scriptFile.mimeType)).trim();
    const { title, style, length, format, platforms, publish_at, machine, ...rest } = brief;
    const machineIds: string[] = [];
    for (const name of String(machine ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
      const id = (await one<any>(`SELECT id FROM machines WHERE lower(name)=lower($1) ORDER BY created_at DESC LIMIT 1`, [name]))?.id;
      if (id) machineIds.push(id);
    }
    const job = await createJob({
      title: title ?? folder.name, brief: rest, kind: takes.length ? 'footage' : voice ? 'voiceover' : 'animation',
      style: styleFromText(style) ?? settings.default_style ?? 'paper_cutout',
      options: { length_sec: lengthFromText(length) ?? (takes.length || voice ? null : Number(settings.default_length_sec ?? 30)), format: /16\s*[:x]\s*9|horizontal|landscape/i.test(format ?? '') ? '16:9' : (settings.default_format ?? '9:16'),
        storyboard: false, music: true, sfx: true },
      source: 'drive', driveFolderId: folder.id, platforms, publishAt: publish_at ?? null, machineIds,
    });
    let k = 0;
    const takeRows: { id: string; file: any }[] = [];
    for (const t of takes.slice(0, 8)) {
      k++;
      const row = await addFile(job.id, { kind: 'take', take_id: `T${k}`, name: t.name, storage_path: t.id, drive_file_id: t.id, drive_link: link(t), md5: t.md5Checksum, size: Number(t.size ?? 0) });
      takeRows.push({ id: row.id, file: t });
    }
    if (voice) await addFile(job.id, { kind: 'voiceover', name: voice.name, storage_path: voice.id, drive_file_id: voice.id, drive_link: link(voice), size: Number(voice.size ?? 0) });
    for (const im of files.filter((f) => IMAGE.test(f.name)).slice(0, 12)) {
      const tags = im.name.replace(/\.[^.]+$/, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      await addFile(job.id, { kind: 'image', name: im.name, storage_path: im.id, drive_file_id: im.id, drive_link: link(im), tags });
    }
    // the folder moves to content_midway as "<code> <title>" and stays the video's folder
    try {
      const mid = await driveCreateFolder(`${job.code} ${job.title}`.slice(0, 120), folders.midway, token);
      const moved = await driveMove(folder.id, mid, token);
      await q(`UPDATE production_jobs SET drive_midway_folder=$2, drive_folder_id=COALESCE($3, drive_folder_id) WHERE id=$1`, [job.id, mid, typeof moved === 'string' ? moved : null]);
      if (ws.local && typeof moved === 'string') {
        // local drive folder: file paths changed with the move
        for (const f of await q<any>(`SELECT id, storage_path FROM production_files WHERE job_id=$1`, [job.id])) {
          if (!isDriveId(f.storage_path)) await q(`UPDATE production_files SET storage_path=replace(storage_path, $2, $3), drive_file_id=replace(drive_file_id, $2, $3) WHERE id=$1`, [f.id, folder.id, moved]);
        }
      }
    } catch (e) { console.warn('[drive] could not move the source folder', (e as Error).message); }
    // a frame of every take for the dashboard (Drive's own preview, or the file itself in the local drive folder)
    for (const r of takeRows) await takeThumbnail(r.id, { driveFile: r.file, token }).catch(() => {});
    created.push(job.code);
  }
  if (!ws.local) await q(`UPDATE workspace_connections SET last_scan_at=now() WHERE id=$1`, [ws.id]);
  return { scanned: true, created };
}

/** Suggestions folder: a text file whose name starts with a job code ("JOB-012 from Ravi.txt") is read as a suggestion. */
export async function scanSuggestions() {
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return;
  const folders = await currentFolders(ws);
  const token = await workspaceToken(ws);
  for (const f of await driveList(folders.suggestions, token)) {
    const m = f.name.match(/^(JOB-\d+)/i);
    if (!m || /suggestions log/i.test(f.name) || !(/\.(txt|md)$/i.test(f.name) || f.mimeType === 'application/vnd.google-apps.document')) continue;
    const job = await one<any>(`SELECT id, status FROM production_jobs WHERE upper(code)=upper($1)`, [m[1]]);
    if (!job || await one(`SELECT 1 FROM production_files WHERE job_id=$1 AND kind='suggestion_file' AND storage_path=$2`, [job.id, f.id])) continue;
    const text = (await driveReadText(f.id, token, f.mimeType)).trim();
    await addFile(job.id, { kind: 'suggestion_file', name: f.name, storage_path: f.id, drive_file_id: f.id });
    if (!text || !['prompt_ready', 'with_claude'].includes(job.status)) continue;
    const who = f.name.replace(/^(JOB-\d+)[\s_-]*/i, '').replace(/\.(txt|md)$/i, '').replace(/^from\s+/i, '').trim() || 'drive';
    await recordSuggestion(job.id, `${who}@drive`, text, 'drive');
  }
}
