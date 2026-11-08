/**
 * Google Drive for the Content Studio: the material for each video is kept there so Claude Code can reach it, and the
 * finished videos are picked up from content_final. Without a Google account the same layout lives in a local folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { ApiError, request } from '../lib/http.js';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'openid', 'email', 'profile',
];

/**
 * Folder layout in "Content Studio":
 *   content_raw      drop one folder per video here (the takes + optional brief.txt / script.txt / pictures)
 *   content_midway   one folder per video ("JOB-012 Title") with its takes, voiceover and pictures, linked in the prompt for Claude
 *   suggestions      one text file per video listing the suggestions; a text file named "<JOB code> ..." dropped here is read as a suggestion
 *   content_final    the finished videos ("JOB-012 Title.mp4" + "JOB-012 captions.txt"); the dashboard lists them under Completed
 *   _assets          brand_kit, music_licensed, style_references, machines
 */
export const FOLDER_NAMES: Record<string, string> = { raw: 'content_raw', midway: 'content_midway', suggestions: 'suggestions', final: 'content_final' };
export const ASSET_FOLDERS: Record<string, string> = { brand: 'brand_kit', music: 'music_licensed', references: 'style_references', machines: 'machines' };
export const ROOT_FOLDER = 'Content Studio';

export interface Workspace { id: string; email: string; folders: Record<string, string>; status: string; local?: boolean }

/** Without a Google account the same flow runs on a local folder (<repo>/drive_local/Content Studio), so it can be demonstrated offline. */
export const LOCAL_DRIVE = path.resolve(process.env.STUDIO_LOCAL_DRIVE || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../drive_local'));
export const isLocal = (t: string) => t === 'local';
/** A Google Drive file id (not a path in the local drive folder). */
export const isDriveId = (id?: string | null) => !!id && !/[\\/]/.test(id) && !/^[A-Za-z]:/.test(id);
const LOCAL_FOLDER = 'application/vnd.google-apps.folder';
let localScanAt = 0;
export function localScanDue(everyMs: number) { if (Date.now() - localScanAt < everyMs) return false; localScanAt = Date.now(); return true; }

function localWorkspace(): Workspace {
  const root = path.join(LOCAL_DRIVE, ROOT_FOLDER);
  const folders: Record<string, string> = { root };
  for (const [k, n] of Object.entries(FOLDER_NAMES)) folders[k] = path.join(root, n);
  for (const [k, n] of Object.entries(ASSET_FOLDERS)) folders[k] = path.join(root, '_assets', n);
  for (const f of Object.values(folders)) fs.mkdirSync(f, { recursive: true });
  return { id: 'local', email: 'local-drive', folders, status: 'connected', local: true };
}

export async function getWorkspace(): Promise<Workspace | null> {
  const g = await one<Workspace>(`SELECT id, email, folders, status FROM workspace_connections WHERE status <> 'disconnected' ORDER BY updated_at DESC LIMIT 1`);
  if (g) return g;
  const st = await one<any>(`SELECT value FROM app_settings WHERE key='studio'`);
  return st?.value?.local_drive === false ? null : localWorkspace();
}

export async function saveWorkspace(email: string, name: string, refresh: string, access: string, expiresIn: number, scopes: string[], userId: string | null) {
  return (await one<{ id: string }>(
    `INSERT INTO workspace_connections (provider, email, display_name, encrypted_refresh, encrypted_access, access_expires_at, scopes, status, connected_by)
     VALUES ('google',$1,$2,$3,$4,$5,$6,'connected',$7)
     ON CONFLICT (provider, email) DO UPDATE SET display_name=EXCLUDED.display_name, encrypted_refresh=EXCLUDED.encrypted_refresh,
       encrypted_access=EXCLUDED.encrypted_access, access_expires_at=EXCLUDED.access_expires_at, scopes=EXCLUDED.scopes, status='connected', last_error=NULL, updated_at=now()
     RETURNING id`,
    [email, name, encrypt(refresh), encrypt(access), new Date(Date.now() + expiresIn * 1000), scopes, userId]))!.id;
}

export async function workspaceToken(ws?: Workspace | null): Promise<string> {
  const w = ws ?? (await getWorkspace());
  if (!w) throw new Error('Google Drive is not connected (Integrations → Content Studio).');
  if (w.local) return 'local';
  const r = await one<any>('SELECT encrypted_refresh, encrypted_access, access_expires_at FROM workspace_connections WHERE id=$1', [w.id]);
  if (r.encrypted_access && r.access_expires_at && new Date(r.access_expires_at).getTime() - Date.now() > 120_000) return decrypt(r.encrypted_access);
  try {
    const res = await request<any>('https://oauth2.googleapis.com/token', {
      method: 'POST', retries: 2,
      form: { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: decrypt(r.encrypted_refresh), grant_type: 'refresh_token' },
    });
    await q(`UPDATE workspace_connections SET encrypted_access=$2, access_expires_at=$3, updated_at=now() WHERE id=$1`,
      [w.id, encrypt(res.access_token), new Date(Date.now() + res.expires_in * 1000)]);
    return res.access_token;
  } catch (e) {
    if (e instanceof ApiError && (e.body?.error === 'invalid_grant' || e.status === 400 || e.status === 401)) {
      await q(`UPDATE workspace_connections SET status='token_expired', last_error=$2 WHERE id=$1`, [w.id,
        'Google refresh token rejected. If the OAuth app is in "Testing" mode tokens expire after 7 days. Reconnect Google Drive.']);
    }
    throw e;
  }
}

const H = (t: string) => ({ authorization: `Bearer ${t}` });
const DRIVE = 'https://www.googleapis.com/drive/v3';

// ---------------------------------------------------------------- Drive
export interface DriveFile { id: string; name: string; mimeType: string; md5Checksum?: string; size?: string; modifiedTime?: string; parents?: string[]; webViewLink?: string; thumbnailLink?: string }

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain', '.md': 'text/plain' };
function localFile(p: string): DriveFile {
  const st = fs.statSync(p);
  return { id: p, name: path.basename(p), mimeType: st.isDirectory() ? LOCAL_FOLDER : MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
    size: String(st.size), modifiedTime: st.mtime.toISOString(), parents: [path.dirname(p)], webViewLink: `file:///${p.replace(/\\/g, '/')}` };
}

export async function driveList(folderId: string, token: string): Promise<DriveFile[]> {
  if (isLocal(token)) {
    if (!fs.existsSync(folderId)) return [];
    return fs.readdirSync(folderId).filter((n) => !n.startsWith('.') && !n.endsWith('.part')).map((n) => localFile(path.join(folderId, n)));
  }
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(`${DRIVE}/files`);
    u.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    u.searchParams.set('fields', 'nextPageToken, files(id,name,mimeType,md5Checksum,size,modifiedTime,parents,webViewLink,thumbnailLink)');
    u.searchParams.set('pageSize', '200');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await request<any>(u.toString(), { headers: H(token) });
    out.push(...(r.files ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

async function findOrCreateFolder(name: string, parent: string | null, token: string): Promise<string> {
  if (isLocal(token)) {
    const p = path.join(parent ?? LOCAL_DRIVE, name.replace(/[<>:"/\\|?*]+/g, '_').trim());
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  const qs = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` + (parent ? ` and '${parent}' in parents` : " and 'root' in parents");
  const r = await request<any>(`${DRIVE}/files?q=${encodeURIComponent(qs)}&fields=files(id)`, { headers: H(token) });
  if (r.files?.[0]) return r.files[0].id;
  const c = await request<any>(`${DRIVE}/files?fields=id`, { method: 'POST', headers: H(token), body: { name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined } });
  return c.id;
}

/** Creates "Content Studio" and its sub-folders in My Drive (idempotent). */
export async function ensureFolders(ws: Workspace): Promise<Record<string, string>> {
  if (ws.local) return localWorkspace().folders;
  const token = await workspaceToken(ws);
  // Folders the user made directly in My Drive (content_raw, content_mid_suggestions, content_final) are used as they are.
  const findRoot = async (name: string) => {
    const qs = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`;
    return (await request<any>(`${DRIVE}/files?q=${encodeURIComponent(qs)}&fields=files(id)`, { headers: H(token) })).files?.[0]?.id as string | undefined;
  };
  const userRaw = await findRoot('content_raw'), userFinal = await findRoot('content_final');
  if (userRaw && userFinal) {
    const mid = (await findRoot('content_mid_suggestions')) ?? (await findRoot('content_midway')) ?? (await findOrCreateFolder('content_mid_suggestions', null, token));
    const folders: Record<string, string> = { root: mid, raw: userRaw, midway: mid, final: userFinal };
    folders.suggestions = await findOrCreateFolder('suggestions', mid, token);
    const assets = await findOrCreateFolder('_assets', mid, token);
    for (const [key, name] of Object.entries(ASSET_FOLDERS)) folders[key] = await findOrCreateFolder(name, assets, token);
    await q(`UPDATE workspace_connections SET folders=$2, updated_at=now() WHERE id=$1`, [ws.id, JSON.stringify(folders)]);
    return folders;
  }
  const root = await findOrCreateFolder(ROOT_FOLDER, null, token);
  const folders: Record<string, string> = { root };
  for (const [key, name] of Object.entries(FOLDER_NAMES)) folders[key] = await findOrCreateFolder(name, root, token);
  const assets = await findOrCreateFolder('_assets', root, token);
  for (const [key, name] of Object.entries(ASSET_FOLDERS)) folders[key] = await findOrCreateFolder(name, assets, token);
  await q(`UPDATE workspace_connections SET folders=$2, updated_at=now() WHERE id=$1`, [ws.id, JSON.stringify(folders)]);
  return folders;
}

/** Folders of the current layout; older connections (01 Raw footage ...) are upgraded on first use. */
export async function currentFolders(ws: Workspace): Promise<Record<string, string>> {
  if (ws.local) return localWorkspace().folders;
  return ws.folders?.raw && ws.folders?.midway && ws.folders?.final && ws.folders?.suggestions && ws.folders?.machines ? ws.folders : ensureFolders(ws);
}

export async function driveDownload(fileId: string, dest: string, token: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isLocal(token)) { fs.copyFileSync(fileId, dest); return; }
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers: H(token) });
  if (!res.ok || !res.body) throw new Error(`Drive download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
}

export async function driveReadText(fileId: string, token: string, mimeType: string): Promise<string> {
  if (isLocal(token)) return fs.existsSync(fileId) ? fs.readFileSync(fileId, 'utf8') : '';
  const url = mimeType === 'application/vnd.google-apps.document' ? `${DRIVE}/files/${fileId}/export?mimeType=text/plain` : `${DRIVE}/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: H(token) });
  return res.ok ? res.text() : '';
}

/** Resumable upload (works for large videos). */
export async function driveUpload(localPath: string, name: string, parent: string, token: string, mimeType = 'video/mp4'): Promise<DriveFile> {
  if (isLocal(token)) {
    fs.mkdirSync(parent, { recursive: true });
    const dest = path.join(parent, name.replace(/[<>:"/\\|?*]+/g, '_'));
    fs.copyFileSync(localPath, dest);
    return localFile(dest);
  }
  const size = fs.statSync(localPath).size;
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,mimeType', {
    method: 'POST', headers: { ...H(token), 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mimeType, 'x-upload-content-length': String(size) },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  if (!init.ok) throw new Error(`Drive upload could not start (${init.status}): ${(await init.text()).slice(0, 300)}`);
  const location = init.headers.get('location')!;
  const put = await fetch(location, { method: 'PUT', headers: { 'content-length': String(size), 'content-type': mimeType }, body: fs.createReadStream(localPath) as any, duplex: 'half' } as any);
  if (!put.ok) throw new Error(`Drive upload failed (${put.status}): ${(await put.text()).slice(0, 300)}`);
  return put.json() as any;
}

export async function driveMove(fileId: string, toFolder: string, token: string) {
  if (isLocal(token)) {
    fs.mkdirSync(toFolder, { recursive: true });
    const dest = path.join(toFolder, path.basename(fileId));
    if (path.resolve(dest) !== path.resolve(fileId)) fs.renameSync(fileId, dest);
    return dest;
  }
  const f = await request<any>(`${DRIVE}/files/${fileId}?fields=parents`, { headers: H(token) });
  const remove = (f.parents ?? []).join(',');
  await request(`${DRIVE}/files/${fileId}?addParents=${toFolder}${remove ? `&removeParents=${remove}` : ''}&fields=id`, { method: 'PATCH', headers: H(token), body: {} });
}

export async function driveCreateFolder(name: string, parent: string, token: string) {
  return findOrCreateFolder(name, parent, token);
}

/** Writes (or replaces) a small text file in a folder. */
export async function driveWriteText(name: string, text: string, parent: string, token: string): Promise<DriveFile> {
  if (isLocal(token)) {
    fs.mkdirSync(parent, { recursive: true });
    const dest = path.join(parent, name.replace(/[<>:"/\\|?*]+/g, '_'));
    fs.writeFileSync(dest, text, 'utf8');
    return localFile(dest);
  }
  const existing = (await driveList(parent, token)).find((f) => f.name === name);
  const meta = { name, mimeType: 'text/plain', ...(existing ? {} : { parents: [parent] }) };
  const boundary = `b${Date.now()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const url = existing ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,name,webViewLink,mimeType`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType';
  const r = await fetch(url, { method: existing ? 'PATCH' : 'POST', headers: { ...H(token), 'content-type': `multipart/related; boundary=${boundary}` }, body });
  if (!r.ok) throw new Error(`Drive write failed (${r.status})`);
  return r.json() as any;
}

/** Streams a Drive file (or a local-drive file) to the browser, with byte ranges for the video player. */
export async function driveStream(fileId: string, token: string, range?: string): Promise<{ status: number; headers: Record<string, string>; body: any } | null> {
  if (isLocal(token)) return null;   // the route serves local files itself
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers: { ...H(token), ...(range ? { range } : {}) } });
  if (!res.ok && res.status !== 206) return { status: res.status, headers: {}, body: null };
  const headers: Record<string, string> = {};
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = res.headers.get(h); if (v) headers[h] = v; }
  return { status: res.status, headers, body: Readable.fromWeb(res.body as any) };
}

/** Downloads Drive's own preview image of a file (videos get one once Drive has processed them), at up to `size` px. */
export async function driveThumbnail(f: DriveFile, dest: string, token: string, size = 1280): Promise<boolean> {
  if (isLocal(token) || !f.thumbnailLink) return false;
  const url = f.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  const res = await fetch(url, { headers: H(token) }).catch(() => null);
  if (!res?.ok || !res.body) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
  return true;
}
