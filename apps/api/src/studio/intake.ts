/**
 * Google Drive intake.
 * Convention: one sub-folder in "content_raw" per video, e.g. "Sensor launch". Inside it:
 *   - the takes (any video files; sorted by name -> T1, T2, T3)
 *   - optional brief.txt / script.txt (or Google Docs named "brief" / "script")
 *   - optional pictures (jpg/png); words in the file name become tags, "product" marks the product shot
 * A folder becomes a job once nothing in it has changed for a few minutes (uploads finished).
 * The folder is then moved to "content_midway" and renamed "<JOB code> <title>"; the rendered versions are added to it.
 */
import path from 'node:path';
import { one, q } from '../db/pool.js';
import { currentFolders, driveCreateFolder, driveDownload, driveList, driveMove, driveReadText, getWorkspace, localScanDue, workspaceToken } from '../integrations/workspace.js';
import { addFile, advance, createJob, jobDir, studioSettings } from './pipeline.js';

const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;

export function parseBrief(text: string): any {
  const brief: any = {};
  const lines = text.split(/\r?\n/);
  const free: string[] = [];
  const keys: Record<string, string> = { title: 'title', headline: 'headline', speaker: 'speaker_name', name: 'speaker_name', role: 'speaker_role', cta: 'cta', 'call to action': 'cta',
    keywords: 'keywords', hashtags: 'hashtags', notes: 'notes', tagline: 'tagline', platforms: 'platforms', 'publish at': 'publish_at', script: 'script',
    styles: 'styles', style: 'styles', machine: 'machine', spellings: 'spellings', spelling: 'spellings', terms: 'glossary', glossary: 'glossary', vocabulary: 'glossary' };
  let inScript = false;
  const script: string[] = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*([A-Za-z ]{3,20})\s*:\s*(.*)$/);
    const key = m ? keys[m[1].trim().toLowerCase()] : undefined;
    if (key === 'script') { inScript = true; if (m![2]) script.push(m![2]); continue; }
    if (key) {
      inScript = false;
      const v = m![2].trim();
      brief[key] = ['keywords', 'hashtags', 'platforms', 'styles', 'glossary'].includes(key) ? v.split(/[,;]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : v;
    } else if (inScript) script.push(ln);
    else if (ln.trim()) free.push(ln.trim());
  }
  if (script.length) brief.script = script.join('\n').trim();
  if (free.length && !brief.notes) brief.notes = free.join(' ');
  return brief;
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
    await q(`UPDATE workspace_connections SET last_scan_at=now() WHERE id=$1`, [ws.id]);
  }
  const folders = await currentFolders(ws);
  const token = await workspaceToken(ws);
  const settle = Number(settings.drive_settle_seconds ?? (ws.local ? 20 : 180)) * 1000;
  const entries = await driveList(folders.raw, token);
  const created: string[] = [];
  for (const folder of entries.filter((e) => e.mimeType === 'application/vnd.google-apps.folder')) {
    if (await one(`SELECT 1 FROM production_jobs WHERE drive_folder_id=$1`, [folder.id])) continue;
    const files = await driveList(folder.id, token);
    const takes = files.filter((f) => VIDEO.test(f.name) || f.mimeType.startsWith('video/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!takes.length) continue;
    const newest = Math.max(...files.map((f) => new Date(f.modifiedTime ?? 0).getTime()));
    if (Date.now() - newest < settle) continue; // still uploading
    const briefFile = files.find((f) => /^brief(\.txt|\.md)?$/i.test(f.name) || (f.mimeType === 'application/vnd.google-apps.document' && /brief/i.test(f.name)));
    const scriptFile = files.find((f) => /^script(\.txt|\.md)?$/i.test(f.name) || (f.mimeType === 'application/vnd.google-apps.document' && /script/i.test(f.name)));
    const brief = briefFile ? parseBrief(await driveReadText(briefFile.id, token, briefFile.mimeType)) : {};
    if (scriptFile) brief.script = (await driveReadText(scriptFile.id, token, scriptFile.mimeType)).trim();
    const styles = (brief.styles as string[] | undefined)?.map((x) => x.toLowerCase().replace(/[^a-z0-9:-]/g, '')).filter(Boolean);
    const job = await createJob({ title: brief.title ?? folder.name, brief, source: 'drive', driveFolderId: folder.id, platforms: brief.platforms, publishAt: brief.publish_at ?? null, styles });
    const dir = jobDir(job.code);
    let k = 0;
    for (const t of takes.slice(0, 6)) {
      k++;
      const dest = path.join(dir, 'takes', `T${k}_${t.name.replace(/[^\w.\-]+/g, '_')}`);
      await driveDownload(t.id, dest, token);
      await addFile(job.id, { kind: 'take', take_id: `T${k}`, name: t.name, storage_path: dest, drive_file_id: t.id, md5: t.md5Checksum, size: Number(t.size ?? 0) });
    }
    for (const im of files.filter((f) => IMAGE.test(f.name)).slice(0, 12)) {
      const dest = path.join(dir, 'images', im.name.replace(/[^\w.\-]+/g, '_'));
      await driveDownload(im.id, dest, token);
      const tags = path.parse(im.name).name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      await addFile(job.id, { kind: 'image', name: im.name, storage_path: dest, drive_file_id: im.id, tags });
    }
    // the source folder moves to content_midway as "<code> <title>"; versions are added to it later
    try {
      const mid = await driveCreateFolder(`${job.code} ${job.title}`.slice(0, 120), folders.midway, token);
      const src = await driveMove(folder.id, mid, token);
      await q(`UPDATE production_jobs SET drive_midway_folder=$2, drive_folder_id=COALESCE($3, drive_folder_id) WHERE id=$1`, [job.id, mid, typeof src === 'string' ? src : null]);
    } catch (e) { console.warn('[drive] could not move the source folder', (e as Error).message); }
    created.push(job.code);
    setImmediate(() => advance(job.id).catch(console.error));
  }
  return { scanned: true, created };
}


/** Suggestions folder: a text file whose name starts with a job code ("JOB-012 from Ravi.txt") is read as a suggestion. */
export async function scanSuggestions() {
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return;
  const folders = await currentFolders(ws);
  const token = await workspaceToken(ws);
  const { recordSuggestion } = await import('./pipeline.js');
  for (const f of await driveList(folders.suggestions, token)) {
    const m = f.name.match(/^(JOB-\d+)/i);
    if (!m || /suggestions log/i.test(f.name) || !(/\.(txt|md)$/i.test(f.name) || f.mimeType === 'application/vnd.google-apps.document')) continue;
    const job = await one<any>(`SELECT id, status FROM production_jobs WHERE upper(code)=upper($1)`, [m[1]]);
    if (!job || await one(`SELECT 1 FROM production_files WHERE job_id=$1 AND kind='suggestion_file' AND storage_path=$2`, [job.id, f.id])) continue;
    const text = (await driveReadText(f.id, token, f.mimeType)).trim();
    await addFile(job.id, { kind: 'suggestion_file', name: f.name, storage_path: f.id, drive_file_id: f.id });
    if (!text) continue;
    if (['new', 'waiting_suggestions', 'analyzing', 'planning'].includes(job.status)) {
      const who = f.name.replace(/^(JOB-\d+)[\s_-]*/i, '').replace(/\.(txt|md)$/i, '').replace(/^from\s+/i, '').trim() || 'drive';
      await recordSuggestion(job.id, `${who}@drive`, text, 'drive');
      setImmediate(() => advance(job.id).catch(console.error));
    }
  }
}
