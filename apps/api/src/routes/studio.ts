import type { FastifyInstance, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { z } from 'zod';
import { env, mediaDir } from '../config.js';
import { one, q } from '../db/pool.js';
import { requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { request } from '../lib/http.js';
import { currentFolders, driveStream, isDriveId, ensureFolders, getWorkspace, LOCAL_DRIVE, saveWorkspace, workspaceToken, WORKSPACE_SCOPES } from '../integrations/workspace.js';
import { addFile, createJob, jobDir, jobPrompt, OPEN_STATUSES, promptCopied, recordSuggestion, scanFinals, studioSettings, uploadFinal, uploadJobFiles, uploadLogo,
  uploadMachinePhotos, uploadMusic, uploadReference, VIDEO_EXT, webLink, coverPath, frameThumbnail, setThumbnail, takeThumbnail } from '../studio/pipeline.js';
import { coverSignature, schedulePublishing } from '../studio/publish.js';
import { finalName, captionsName, thumbnailName } from '../studio/handoff.js';
import { toJpeg } from '../studio/thumbs.js';
import { forgetStyleName, isValidStyle, listStyles, styleName } from '../studio/styles.js';
import { PACK_LIMITS, parsePack } from '../studio/packFormat.js';
import { deletePack, loadPacks, packThumb, savePack } from '../studio/packs.js';
import { scanDrive } from '../studio/intake.js';
import { studio } from '../studio/studioClient.js';
import { learningsFor } from '../studio/learnings.js';

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const safeName = (s: string) => s.replace(/[^\w.\-]+/g, '_').slice(-120);
const PLATFORM = z.enum(['instagram', 'facebook', 'youtube']);

function sendFile(reply: FastifyReply, file: string, range: string | undefined, type: string) {
  if (!file || !fs.existsSync(file)) return reply.code(404).send({ error: 'File not found' });
  const size = fs.statSync(file).size;
  reply.header('accept-ranges', 'bytes').header('content-type', type).header('cache-control', 'private, max-age=300');
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', String(end - start + 1));
    return reply.send(fs.createReadStream(file, { start, end }));
  }
  reply.header('content-length', String(size));
  return reply.send(fs.createReadStream(file));
}

/** Plays a file from Google Drive (or from the local drive folder) in the browser, with byte ranges. */
async function streamDrive(reply: FastifyReply, fileId: string | null | undefined, range: string | undefined, type = 'video/mp4') {
  if (!fileId) return reply.code(404).send({ error: 'File not found' });
  if (!isDriveId(fileId)) {
    const full = path.resolve(fileId);
    if (!full.startsWith(path.resolve(LOCAL_DRIVE)) && !full.startsWith(path.resolve(mediaDir))) return reply.code(403).send({ error: 'Outside the studio folders' });
    return sendFile(reply, full, range, type);
  }
  const ws = await getWorkspace();
  if (!ws || ws.local || ws.status !== 'connected') return reply.code(404).send({ error: 'The file is in Google Drive, but Drive is not connected' });
  const r = await driveStream(fileId, await workspaceToken(ws), range);
  if (!r?.body) return reply.code(r?.status ?? 404).send({ error: 'Could not read the file from Drive' });
  reply.code(r.status);
  for (const [k, v] of Object.entries(r.headers)) reply.header(k, v);
  reply.header('cache-control', 'private, max-age=300');
  return reply.send(r.body);
}

async function saveUpload(part: any, dir: string): Promise<{ dest: string; size: number; md5: string; name: string }> {
  fs.mkdirSync(dir, { recursive: true });
  const name = part.filename as string;
  const dest = path.join(dir, `${Date.now()}_${safeName(name)}`);
  const hash = crypto.createHash('md5');
  part.file.on('data', (c: Buffer) => hash.update(c));
  await streamPipeline(part.file, fs.createWriteStream(dest));
  return { dest, size: fs.statSync(dest).size, md5: hash.digest('hex'), name };
}

const briefSchema = z.object({
  topic: z.string().max(4000).optional(), headline: z.string().max(140).optional(), script: z.string().max(20000).optional(),
  speaker_name: z.string().max(60).optional(), speaker_role: z.string().max(80).optional(), cta: z.string().max(80).optional(),
  keywords: z.array(z.string().max(40)).max(30).optional(), hashtags: z.array(z.string().max(40)).max(15).optional(), notes: z.string().max(4000).optional(),
  language: z.string().max(8).optional(), spellings: z.string().max(1000).optional(),
}).partial();
const optionsSchema = z.object({
  length_sec: z.number().int().min(5).max(1800).nullish(), format: z.enum(['9:16', '16:9']).default('9:16'),
  storyboard: z.boolean().default(false), music: z.boolean().default(true), sfx: z.boolean().default(true), subtitles: z.boolean().default(false),
});
const jobSetup = z.object({
  title: z.string().trim().min(2).max(140), brief: briefSchema.default({}), kind: z.enum(['footage', 'voiceover', 'animation']).default('footage'),
  style: z.string().refine(isValidStyle, 'Pick one of the styles'), options: optionsSchema.default({ format: '9:16', storyboard: false, music: true, sfx: true, subtitles: false }),
  platforms: z.array(PLATFORM).min(1).optional(), music_track_id: z.string().uuid().nullish(), publish_at: z.string().datetime().nullish(),
  machine_ids: z.array(z.string().uuid()).max(6).optional(),
});

/** Reads one uploaded file into memory, up to `max` bytes; a larger file is read through and dropped. */
async function readCapped(part: any, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of part.file) { n += c.length; if (n <= max) chunks.push(c as Buffer); }
  return n <= max ? Buffer.concat(chunks) : null;
}

export async function studioRoutes(app: FastifyInstance) {
  await loadPacks();
  setInterval(() => { loadPacks().catch(() => {}); }, 60_000).unref();
  const view = { preHandler: requirePermission('studio.view') };
  const manage = { preHandler: requirePermission('studio.manage') };
  const suggest = { preHandler: requirePermission('studio.suggest', 'studio.manage') };
  const settingsPerm = { preHandler: requirePermission('settings.manage', 'studio.manage') };

  const getJob = (id: string) => one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);

  // ---------------- status + settings
  app.get('/api/studio/status', view, async () => {
    const health = await studio.health().catch((e) => ({ ok: false, error: (e as Error).message }));
    const g = await one<any>(`SELECT id, email, status, folders, last_error, last_scan_at FROM workspace_connections WHERE status <> 'disconnected' ORDER BY updated_at DESC LIMIT 1`);
    const ws = g ?? (await getWorkspace().then((l) => (l ? { id: 'local', email: 'Local drive folder', status: 'connected', local: true, root: path.join(LOCAL_DRIVE, 'Content Studio') } : null)));
    const accounts = await q<any>(`SELECT sa.platform_code, sa.display_name, sa.status, (SELECT scopes FROM social_account_tokens t WHERE t.social_account_id=sa.id ORDER BY updated_at DESC LIMIT 1) AS scopes
                                     FROM social_accounts sa WHERE sa.data_origin='live' AND sa.status <> 'disconnected'`);
    const can = (a: any) => a.platform_code === 'youtube' ? (a.scopes ?? []).some((s: string) => s.includes('youtube.upload')) : a.platform_code === 'instagram' ? (a.scopes ?? []).includes('instagram_content_publish') : (a.scopes ?? []).includes('pages_manage_posts');
    return {
      service: { ok: !!(health as any)?.ok, style_measuring: !!(health as any)?.studio?.ok },
      workspace: ws, google_configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      publishing: accounts.map((a) => ({ platform: a.platform_code, account: a.display_name, status: a.status, can_publish: can(a) })),
    };
  });

  app.get('/api/studio/settings', view, async () => studioSettings());
  app.put('/api/studio/settings', settingsPerm, async (req) => {
    const b = z.object({
      storage_mode: z.enum(['drive', 'local']).optional(), default_platforms: z.array(PLATFORM).optional(),
      default_style: z.string().refine(isValidStyle, 'unknown style').optional(), default_format: z.enum(['9:16', '16:9']).optional(),
      default_length_sec: z.number().int().min(5).max(1800).optional(),
      youtube_privacy: z.enum(['private', 'unlisted', 'public']).optional(), drive_scan_minutes: z.number().min(1).max(120).optional(),
      glossary: z.array(z.string().max(60)).max(100).optional(),
      brand: z.object({ company_name: z.string().max(80).optional(), handle: z.string().max(60).optional(), tagline: z.string().max(120).optional(), cta: z.string().max(80).optional(),
        colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional() }).partial().optional(),
    }).parse(req.body);
    const cur = await studioSettings();
    const next = { ...cur, ...b, brand: { ...(cur.brand ?? {}), ...(b.brand ?? {}) } };
    await q(`INSERT INTO app_settings (key, value) VALUES ('studio',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(next)]);
    await audit(req.user_!.id, 'studio.settings', 'app_settings', 'studio', b);
    return next;
  });

  app.post('/api/studio/brand/logo', settingsPerm, async (req, reply) => {
    const part = await (req as any).file();
    if (!part || !IMAGE_EXT.test(part.filename)) return reply.code(400).send({ error: 'Upload a PNG or JPG logo' });
    const dir = path.join(mediaDir, 'studio', 'brand');
    const up = await saveUpload(part, dir);
    // the colours are read from the logo when the video service runs; the logo itself is used as uploaded
    const info = await studio.logo(up.dest, dir).catch(() => null);
    const cur = await studioSettings();
    const colors = Object.fromEntries(Object.entries(info?.palette ?? {}).filter(([k]) => ['primary', 'accent', 'alert', 'dark', 'darker', 'light'].includes(k)));
    const link = await uploadLogo(up.dest).catch(() => null);
    const next = { ...cur, brand: { ...(cur.brand ?? {}), logo_path: up.dest, logo_drive_link: link, colors: { ...(cur.brand?.colors ?? {}), ...colors } } };
    await q(`UPDATE app_settings SET value=$1, updated_at=now() WHERE key='studio'`, [JSON.stringify(next)]);
    return { ...next.brand, found_colors: Object.keys(colors).length > 0 };
  });
  app.get('/api/studio/brand/logo', view, async (req, reply) => {
    const s = await studioSettings();
    return sendFile(reply, s.brand?.logo_path, undefined, /\.jpe?g$/i.test(s.brand?.logo_path ?? '') ? 'image/jpeg' : 'image/png');
  });

  // ---------------- music library (licensed only)
  app.get('/api/studio/music', view, async () => q(`SELECT * FROM music_tracks ORDER BY is_active DESC, created_at DESC`));
  app.post('/api/studio/music', manage, async (req, reply) => {
    const dir = path.join(mediaDir, 'studio', 'music');
    const fields: Record<string, string> = {};
    let track: any = null, license: any = null;
    for await (const part of (req as any).parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file') track = await saveUpload(part, dir);
        else if (part.fieldname === 'license') license = await saveUpload(part, path.join(dir, 'licenses'));
        else part.file.resume();
      } else fields[part.fieldname] = String(part.value ?? '');
    }
    if (!track || !AUDIO_EXT.test(track.name)) return reply.code(400).send({ error: 'Upload the music file (mp3, wav, m4a)' });
    if (!license && !fields.license_note) return reply.code(400).send({ error: 'A licence file or licence note is required. Only licensed music can be used.' });
    const src = z.enum(['pixabay', 'youtube_audio_library', 'meta_sound_collection', 'uppbeat', 'epidemic_sound', 'artlist', 'own', 'other']).parse(fields.source || 'other');
    const row = await one<any>(`INSERT INTO music_tracks (title, artist, source, storage_path, license_path, license_note, source_url, content_id_registered, mood, added_by)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fields.title || path.parse(track.name).name.replace(/^\d+_/, ''), fields.artist || null, src, track.dest, license?.dest ?? fields.license_note ?? null, fields.license_note || null,
       fields.source_url || null, fields.content_id_registered === 'true', fields.mood || null, req.user_!.id]);
    setImmediate(() => uploadMusic(row.id).catch((e) => console.warn('[studio] music upload', e.message)));
    await audit(req.user_!.id, 'studio.music.add', 'music_track', row.id, { source: src });
    return row;
  });
  app.patch('/api/studio/music/:id', manage, async (req) => {
    const b = z.object({ is_active: z.boolean().optional(), content_id_registered: z.boolean().optional(), mood: z.string().max(40).optional() }).parse(req.body);
    return one(`UPDATE music_tracks SET is_active=coalesce($2,is_active), content_id_registered=coalesce($3,content_id_registered), mood=coalesce($4,mood) WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.is_active ?? null, b.content_id_registered ?? null, b.mood ?? null]);
  });
  app.get('/api/studio/music/:id/audio', view, async (req, reply) => {
    const t = await one<any>('SELECT storage_path FROM music_tracks WHERE id=$1', [(req.params as any).id]);
    return sendFile(reply, t?.storage_path, req.headers.range, 'audio/mpeg');
  });

  // ---------------- videos
  app.get('/api/studio/jobs', view, async (req) => {
    const origin = (req.query as any).origin === 'demo' ? 'demo' : 'live';
    return q(`SELECT j.id, j.code, j.title, j.status, j.status_detail, j.kind, j.source, j.platforms, j.styles, j.options, j.created_at, j.updated_at, j.publish_at,
                     j.prompt_copied_at, j.completed_at, j.final_drive_link, j.final_name, ci.code AS content_code,
                     (j.thumbnail_path IS NOT NULL OR EXISTS (SELECT 1 FROM production_files tf WHERE tf.job_id=j.id AND tf.kind='take' AND tf.thumb_path IS NOT NULL)) AS has_cover,
                     floor(extract(epoch from coalesce(j.thumbnail_updated_at, j.updated_at)))::bigint AS cover_v, j.thumbnail_source,
                     (SELECT count(*)::int FROM production_files f WHERE f.job_id=j.id AND f.kind='take') AS takes,
                     (SELECT count(*)::int FROM production_suggestions s WHERE s.job_id=j.id AND NOT s.is_none) AS suggestions,
                     (SELECT coalesce(array_agg(DISTINCT pj.platform_code), '{}') FROM publish_jobs pj WHERE pj.job_id=j.id AND pj.status='published') AS published_on
                FROM production_jobs j LEFT JOIN content_items ci ON ci.id=j.content_item_id WHERE j.data_origin=$1 ORDER BY j.created_at DESC LIMIT 300`, [origin]);
  });

  app.post('/api/studio/jobs', manage, async (req) => {
    const b = jobSetup.parse(req.body);
    const job = await createJob({ title: b.title, brief: b.brief, kind: b.kind, style: b.style, options: b.options, platforms: b.platforms, musicTrackId: b.music_track_id ?? null,
      publishAt: b.publish_at ?? null, userId: req.user_!.id, machineIds: b.machine_ids ?? [] });
    await audit(req.user_!.id, 'studio.job.create', 'production_job', job.id, { title: b.title, style: b.style });
    return job;
  });

  app.patch('/api/studio/jobs/:id', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (['publishing', 'published'].includes(job.status)) return reply.code(409).send({ error: 'Already published' });
    const b = jobSetup.partial().parse(req.body);
    await q(`UPDATE production_jobs SET title=coalesce($2,title), brief=CASE WHEN $3::jsonb IS NULL THEN brief ELSE brief || $3::jsonb END, kind=coalesce($4,kind),
               styles=coalesce($5,styles), options=CASE WHEN $6::jsonb IS NULL THEN options ELSE options || $6::jsonb END, platforms=coalesce($7,platforms),
               music_track_id=CASE WHEN $8::boolean THEN $9::uuid ELSE music_track_id END, publish_at=CASE WHEN $10::boolean THEN $11::timestamptz ELSE publish_at END,
               machine_ids=coalesce($12::uuid[], machine_ids), updated_at=now() WHERE id=$1`,
      [id, b.title ?? null, b.brief ? JSON.stringify(b.brief) : null, b.kind ?? null, b.style ? [b.style] : null, b.options ? JSON.stringify(b.options) : null, b.platforms ?? null,
       'music_track_id' in (req.body as any), b.music_track_id ?? null, 'publish_at' in (req.body as any), b.publish_at ?? null, b.machine_ids ?? null]);
    return getJob(id);
  });

  app.post('/api/studio/jobs/:id/files', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const out: any[] = [];
    const fields: Record<string, string> = {};
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') { fields[part.fieldname] = String(part.value ?? ''); continue; }
      const isVideo = VIDEO_EXT.test(part.filename), isImage = IMAGE_EXT.test(part.filename), isAudio = AUDIO_EXT.test(part.filename);
      if (!isVideo && !isImage && !isAudio) { part.file.resume(); continue; }
      const up = await saveUpload(part, path.join(jobDir(job.code), isVideo ? 'takes' : isAudio ? 'voiceover' : 'images'));
      if (isVideo) {
        const n = ((await one<any>(`SELECT count(*)::int AS n FROM production_files WHERE job_id=$1 AND kind='take'`, [id]))!.n) + 1;
        const row = await addFile(id, { kind: 'take', take_id: `T${n}`, name: up.name, storage_path: up.dest, md5: up.md5, size: up.size });
        await takeThumbnail(row.id).catch(() => {});   // before the take goes to Drive and leaves this computer
        out.push(row);
      } else if (isAudio) {
        await q(`DELETE FROM production_files WHERE job_id=$1 AND kind='voiceover'`, [id]);
        out.push(await addFile(id, { kind: 'voiceover', name: up.name, storage_path: up.dest, md5: up.md5, size: up.size }));
      } else {
        const tags = [...(fields.tags ?? '').split(/[,;]/), ...path.parse(up.name).name.split(/[^a-zA-Z0-9]+/)].map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
        out.push(await addFile(id, { kind: 'image', name: up.name, storage_path: up.dest, md5: up.md5, size: up.size, tags: [...new Set(tags)] }));
      }
    }
    // the material goes to the video's Drive folder, so Claude can download it
    setImmediate(() => uploadJobFiles(id).catch(console.error));
    return out;
  });
  app.post('/api/studio/jobs/:id/upload-to-drive', manage, async (req) => uploadJobFiles((req.params as any).id));

  app.delete('/api/studio/jobs/:id/files/:fileId', manage, async (req) => {
    const { id, fileId } = req.params as any;
    await q(`DELETE FROM production_files WHERE id=$2 AND job_id=$1 AND (SELECT status FROM production_jobs WHERE id=$1) = ANY($3)`, [id, fileId, OPEN_STATUSES]);
    return { ok: true };
  });

  app.delete('/api/studio/jobs/:id', manage, async (req, reply) => {
    const { id } = req.params as any;
    const r = await one(`UPDATE production_jobs SET status='cancelled', status_detail='Cancelled', updated_at=now() WHERE id=$1 AND status NOT IN ('publishing','published') RETURNING id`, [id]);
    if (!r) return reply.code(409).send({ error: 'A published video cannot be cancelled' });
    await q(`UPDATE publish_jobs SET status='cancelled' WHERE job_id=$1 AND status IN ('scheduled','manual')`, [id]);
    await audit(req.user_!.id, 'studio.job.cancel', 'production_job', id);
    return { ok: true };
  });
  /** Back to "Editing with Claude" (e.g. a cancelled video, or to replace the finished file). */
  app.post('/api/studio/jobs/:id/reopen', manage, async (req, reply) => {
    const { id } = req.params as any;
    const r = await one(`UPDATE production_jobs SET status=CASE WHEN prompt_copied_at IS NULL THEN 'prompt_ready' ELSE 'with_claude' END, status_detail=NULL,
                           final_drive_file_id=NULL, final_drive_link=NULL, final_path=NULL, final_name=NULL, final_size=NULL, final_captions=NULL, final_captions_file_id=NULL,
                           thumbnail_path=NULL, thumbnail_drive_id=NULL, thumbnail_source=NULL, thumbnail_time=NULL, thumbnail_updated_at=now(),
                           completed_at=NULL, updated_at=now()
                         WHERE id=$1 AND status IN ('cancelled','completed') RETURNING id`, [id]);
    if (!r) return reply.code(409).send({ error: 'Only a cancelled or completed (not yet published) video can be reopened' });
    await audit(req.user_!.id, 'studio.job.reopen', 'production_job', id);
    return { ok: true };
  });

  app.get('/api/studio/jobs/:id', view, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>(`SELECT j.*, ci.code AS content_code FROM production_jobs j LEFT JOIN content_items ci ON ci.id=j.content_item_id WHERE j.id=$1`, [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const files = await q<any>(`SELECT id, kind, take_id, name, size_bytes, tags, drive_file_id, drive_link, thumb_path, created_at FROM production_files WHERE job_id=$1 AND kind IN ('take','image','voiceover') ORDER BY kind, take_id, created_at`, [id]);
    for (const f of files) { f.drive_link = webLink(f.drive_link); f.in_drive = !!f.drive_file_id; f.has_thumb = !!(f.thumb_path && fs.existsSync(f.thumb_path)); delete f.drive_file_id; delete f.thumb_path; }
    const suggestions = await q(`SELECT id, from_email, text, is_none, source, received_at FROM production_suggestions WHERE job_id=$1 ORDER BY received_at`, [id]);
    const publishing = await q(`SELECT id, platform_code, format, scheduled_at, status, permalink, error, attempts, title, caption, tags, updated_at FROM publish_jobs WHERE job_id=$1 ORDER BY platform_code`, [id]);
    job.style = job.styles?.[0] ?? null;
    job.style_name = await styleName(job.style);
    job.machines = (job.machine_ids ?? []).length ? await q(`SELECT id, name, notes, cardinality(photos) AS photos, cardinality(photo_links) AS photos_in_drive FROM machines WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`, [job.machine_ids]) : [];
    job.music = job.music_track_id ? await one(`SELECT id, title, artist, source FROM music_tracks WHERE id=$1`, [job.music_track_id]) : null;
    job.final_drive_link = webLink(job.final_drive_link);
    job.has_final = !!(job.final_drive_file_id || (job.final_path && fs.existsSync(job.final_path)));
    job.expected_final_name = finalName(job.code, job.title);
    job.expected_captions_name = captionsName(job.code);
    job.expected_thumbnail_name = thumbnailName(job.code);
    job.has_cover = !!(await coverPath(job));
    job.cover_v = Math.floor(new Date(job.thumbnail_updated_at ?? job.updated_at).getTime() / 1000);
    job.folder_link = job.drive_midway_folder && isDriveId(job.drive_midway_folder) ? `https://drive.google.com/drive/folders/${job.drive_midway_folder}` : null;
    for (const k of ['final_path', 'final_drive_file_id', 'drive_midway_folder', 'drive_folder_id', 'final_captions_file_id', 'thumbnail_path', 'thumbnail_drive_id']) delete job[k];
    return { job, files, suggestions, publishing };
  });

  // ---------------- the prompt for Claude Code
  app.get('/api/studio/jobs/:id/prompt', view, async (req, reply) => {
    const job = await getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    return { prompt: await jobPrompt(job.id) };
  });
  app.post('/api/studio/jobs/:id/prompt/copied', manage, async (req, reply) => {
    const job = await getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    return promptCopied(job.id, req.user_!.id);
  });

  app.post('/api/studio/jobs/:id/suggestions', suggest, async (req, reply) => {
    const { id } = req.params as any;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (!OPEN_STATUSES.includes(job.status)) return reply.code(409).send({ error: 'This video is already finished; suggestions can be added while it is being made.' });
    const b = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    return recordSuggestion(id, req.user_!.email, b.text, 'app');
  });

  // ---------------- the finished video
  app.post('/api/studio/jobs/:id/final', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (['publishing', 'published'].includes(job.status)) return reply.code(409).send({ error: 'Already published' });
    let up: any = null, captions: string | null = null;
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') { if (part.fieldname === 'captions') captions = String(part.value ?? ''); continue; }
      if (part.fieldname === 'captions_file' && /\.(txt|md)$/i.test(part.filename)) { const chunks: Buffer[] = []; for await (const c of part.file) chunks.push(c); captions = Buffer.concat(chunks).toString('utf8'); continue; }
      if (!up && VIDEO_EXT.test(part.filename)) up = await saveUpload(part, path.join(jobDir(job.code), 'final'));
      else part.file.resume();
    }
    if (!up) return reply.code(400).send({ error: 'Upload the finished video (MP4)' });
    try { await uploadFinal(job, up.dest, up.name, captions); }
    catch (e) { return reply.code(502).send({ error: `Saved here, but could not put it in Google Drive: ${(e as Error).message}` }); }
    await audit(req.user_!.id, 'studio.final.upload', 'production_job', id, { name: up.name });
    return { ok: true };
  });
  app.get('/api/studio/jobs/:id/final', view, async (req, reply) => {
    const j = await getJob((req.params as any).id);
    if ((req.query as any).download) reply.header('content-disposition', `attachment; filename="${(j?.final_name ?? 'video.mp4').replace(/"/g, '')}"`);
    if (j?.final_path && fs.existsSync(j.final_path)) return sendFile(reply, j.final_path, req.headers.range, 'video/mp4');
    if (!j?.final_drive_file_id) return reply.code(404).send({ error: 'This video has no finished file yet' });
    return streamDrive(reply, j.final_drive_file_id, req.headers.range);
  });
  app.patch('/api/studio/jobs/:id/captions', manage, async (req) => {
    const b = z.object({ instagram: z.string().max(2200).optional(), facebook: z.string().max(5000).optional(), youtube_title: z.string().max(100).optional(),
      youtube_description: z.string().max(5000).optional(), youtube_tags: z.array(z.string().max(60)).max(30).optional() }).parse(req.body);
    return one(`UPDATE production_jobs SET final_captions=coalesce(final_captions,'{}'::jsonb) || $2::jsonb, updated_at=now() WHERE id=$1 RETURNING final_captions`, [(req.params as any).id, JSON.stringify(b)]);
  });

  /** Everything finished: completed (ready to publish), publishing and published videos. */
  app.get('/api/studio/completed', view, async (req) => {
    const origin = (req.query as any).origin === 'demo' ? 'demo' : 'live';
    const ws = await getWorkspace().catch(() => null);
    const rows = await q<any>(`SELECT j.id, j.code, j.title, j.status, j.status_detail, j.styles, j.platforms, j.completed_at, j.final_name, j.final_size, j.final_drive_link,
                                      j.final_source, j.final_captions, j.final_error, j.source, j.options, j.thumbnail_source, j.thumbnail_time,
                                      (j.thumbnail_path IS NOT NULL OR EXISTS (SELECT 1 FROM production_files tf WHERE tf.job_id=j.id AND tf.kind='take' AND tf.thumb_path IS NOT NULL)) AS has_cover,
                                      floor(extract(epoch from coalesce(j.thumbnail_updated_at, j.updated_at)))::bigint AS cover_v,
                                      (SELECT coalesce(json_agg(json_build_object('platform', pj.platform_code, 'status', pj.status, 'permalink', pj.permalink, 'error', pj.error) ORDER BY pj.platform_code), '[]')
                                         FROM publish_jobs pj WHERE pj.job_id=j.id AND pj.status <> 'cancelled') AS posts
                                 FROM production_jobs j WHERE j.data_origin=$1 AND j.completed_at IS NOT NULL AND j.status IN ('completed','publishing','published')
                                ORDER BY j.completed_at DESC LIMIT 300`, [origin]);
    for (const r of rows) { r.style_name = await styleName(r.styles?.[0]); r.final_drive_link = webLink(r.final_drive_link); }
    return {
      folder: ws ? (ws.local ? path.join(LOCAL_DRIVE, 'Content Studio', 'content_final') : `Google Drive (${ws.email}) › content_final`) : null,
      google: !!ws && !ws.local, items: rows,
    };
  });
  /** Look in content_final now (otherwise every few minutes). */
  app.post('/api/studio/completed/scan', manage, async (req) => {
    const r = await scanFinals(true);
    await audit(req.user_!.id, 'studio.final.scan', 'production_job', null, r);
    return r;
  });

  // ---------------- thumbnails
  /** The video's thumbnail (or a frame of its first take while it is being made). */
  app.get('/api/studio/jobs/:id/thumbnail', view, async (req, reply) => {
    const j = await getJob((req.params as any).id);
    const p = j ? await coverPath(j) : null;
    if (!p) return reply.code(404).send({ error: 'No thumbnail yet' });
    return sendFile(reply, p, undefined, 'image/jpeg');
  });
  /** Public, signed link to a thumbnail: Instagram fetches the reel cover from here (see publish.ts). No login. */
  app.get('/api/public/covers/:jobId/:v/:file', async (req, reply) => {
    const { jobId, v, file } = req.params as any;
    const j = /^[0-9a-f-]{36}$/i.test(jobId) ? await getJob(jobId) : null;
    const current = j?.thumbnail_updated_at ? String(new Date(j.thumbnail_updated_at).getTime()) : null;
    if (!j || v !== current || String(file).replace(/\.jpg$/, '') !== coverSignature(jobId, v)) return reply.code(404).send({ error: 'Not found' });
    return sendFile(reply, j.thumbnail_path, undefined, 'image/jpeg');
  });
  app.get('/api/studio/files/:id/thumbnail', view, async (req, reply) => {
    const f = await one<any>('SELECT thumb_path FROM production_files WHERE id=$1', [(req.params as any).id]);
    return sendFile(reply, f?.thumb_path, undefined, 'image/jpeg');
  });
  /** Upload your own thumbnail (JPEG, PNG or WebP). */
  app.post('/api/studio/jobs/:id/thumbnail', manage, async (req, reply) => {
    const job = await getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const part = await (req as any).file();
    if (!part || !IMAGE_EXT.test(part.filename)) return reply.code(400).send({ error: 'Upload a JPG, PNG or WebP image' });
    const up = await saveUpload(part, path.join(jobDir(job.code), 'incoming'));
    const jpg = `${up.dest}.jpg`;
    try { await toJpeg(up.dest, jpg); await setThumbnail(job, jpg, 'upload'); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    finally { for (const x of [up.dest, jpg]) { try { fs.unlinkSync(x); } catch { /* gone */ } } }
    await audit(req.user_!.id, 'studio.thumbnail.upload', 'production_job', job.id);
    return { ok: true };
  });
  /** Use a frame of the finished video as the thumbnail (time in seconds; empty = pick a good frame automatically). */
  app.post('/api/studio/jobs/:id/thumbnail/frame', manage, async (req, reply) => {
    const job = await getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const b = z.object({ time: z.number().min(0).max(36000).nullish() }).parse(req.body ?? {});
    try { await frameThumbnail(job, b.time ?? null, b.time == null ? 'auto' : 'frame'); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    return { ok: true };
  });

  // ---------------- publishing
  app.post('/api/studio/jobs/:id/publish', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (!['completed', 'publishing', 'published'].includes(job.status)) return reply.code(409).send({ error: 'Put the finished video in content_final first' });
    const b = z.object({
      posts: z.array(z.object({ platform: PLATFORM, caption: z.string().max(5000).default(''), title: z.string().max(100).nullish(), tags: z.array(z.string().max(60)).max(30).optional() })).min(1),
      publish_at: z.string().datetime().nullish(),
    }).parse(req.body);
    const yt = b.posts.find((p) => p.platform === 'youtube');
    if (yt && !yt.title?.trim()) return reply.code(400).send({ error: 'Give the YouTube video a title' });
    try { await schedulePublishing(job, b.posts, b.publish_at ? new Date(b.publish_at) : null); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    await audit(req.user_!.id, 'studio.publish', 'production_job', id, { platforms: b.posts.map((p) => p.platform), at: b.publish_at ?? 'now' });
    return { ok: true };
  });
  app.post('/api/studio/publish-jobs/:id/retry', manage, async (req) => {
    await q(`UPDATE publish_jobs SET status='scheduled', scheduled_at=now(), error=NULL, attempts=0 WHERE id=$1 AND status IN ('failed','manual')`, [(req.params as any).id]);
    await q(`UPDATE production_jobs SET status='publishing' WHERE id=(SELECT job_id FROM publish_jobs WHERE id=$1) AND status='published'`, [(req.params as any).id]);
    return { ok: true };
  });
  /** A post made by hand on the platform: record its link so the video counts as published there. */
  app.post('/api/studio/publish-jobs/:id/posted', manage, async (req) => {
    const b = z.object({ permalink: z.string().url().max(500).nullish() }).parse(req.body ?? {});
    await q(`UPDATE publish_jobs SET status='published', permalink=coalesce($2, permalink), error=NULL, updated_at=now() WHERE id=$1 AND status IN ('failed','manual')`, [(req.params as any).id, b.permalink ?? null]);
    return { ok: true };
  });

  // ---------------- editing styles: the 9 presets + styles learned from reference videos
  app.get('/api/studio/styles', view, async () => listStyles());
  // what past videos teach for the one being set up (New video page; the same list goes into the prompt)
  app.get('/api/studio/learnings', view, async (req) => {
    const qs = z.object({ style: z.string().max(80).optional(), platforms: z.string().max(80).optional(), origin: z.string().optional() }).parse(req.query ?? {});
    const platforms = (qs.platforms ?? '').split(',').filter((p) => PLATFORM.safeParse(p).success);
    return learningsFor(qs.origin === 'demo' ? 'demo' : 'live', { style: qs.style || null, platforms });
  });
  app.post('/api/studio/styles', manage, async (req, reply) => {
    const dir = path.join(mediaDir, 'studio', 'styles');
    const fields: Record<string, string> = {};
    let up: any = null;
    for await (const part of (req as any).parts()) {
      if (part.type === 'file') { if (VIDEO_EXT.test(part.filename) && !up) up = await saveUpload(part, dir); else part.file.resume(); }
      else fields[part.fieldname] = String(part.value ?? '');
    }
    if (!up) return reply.code(400).send({ error: 'Upload a reference video (mp4 / mov)' });
    const name = (fields.name || path.parse(up.name).name).slice(0, 60);
    const row = await one<any>(`INSERT INTO style_profiles (name, source_name, source_path, notes, status, created_by) VALUES ($1,$2,$3,$4,'analysing',$5) RETURNING *`,
      [name, up.name, up.dest, (fields.notes ?? '').slice(0, 2000) || null, req.user_!.id]);
    setImmediate(async () => {
      await uploadReference(row.id).catch((e) => console.warn('[studio] reference upload', e.message));
      try {
        const r = await studio.extractStyle(up.dest, name);
        await q(`UPDATE style_profiles SET report=$2, measured=$3, summary=$4, status='ready', error=NULL, updated_at=now() WHERE id=$1`,
          [row.id, JSON.stringify(r.report ?? []), JSON.stringify(r.measured ?? null), r.summary ?? null]);
      } catch (e) {
        // still usable: Claude watches the reference video itself
        await q(`UPDATE style_profiles SET status='ready', error=$2, updated_at=now() WHERE id=$1`, [row.id, `Not measured (${(e as Error).message.slice(0, 300)}). Claude will watch the video itself.`]);
      }
    });
    await audit(req.user_!.id, 'studio.style.add', 'style_profile', row.id, { name });
    return row;
  });
  app.patch('/api/studio/styles/:id', manage, async (req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), notes: z.string().max(2000).nullish() }).parse(req.body);
    forgetStyleName(`profile:${(req.params as any).id}`);
    return one(`UPDATE style_profiles SET name=coalesce($2,name), notes=CASE WHEN $3::boolean THEN $4 ELSE notes END, updated_at=now() WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.name ?? null, 'notes' in b, b.notes ?? null]);
  });
  app.delete('/api/studio/styles/:id', manage, async (req, reply) => {
    const key = `profile:${(req.params as any).id}`;
    const used = await one<any>(`SELECT code FROM production_jobs WHERE $1 = ANY(styles) AND status IN ('prompt_ready','with_claude') LIMIT 1`, [key]);
    if (used) return reply.code(409).send({ error: `${used.code} is being made in this style. Change its style first.` });
    await q(`DELETE FROM style_profiles WHERE id=$1`, [(req.params as any).id]);
    return { ok: true };
  });
  app.get('/api/studio/styles/:id/video', view, async (req, reply) => {
    const p = await one<any>('SELECT source_path, drive_file_id FROM style_profiles WHERE id=$1', [(req.params as any).id]);
    if (p?.source_path && fs.existsSync(p.source_path)) return sendFile(reply, p.source_path, req.headers.range, 'video/mp4');
    return streamDrive(reply, p?.drive_file_id, req.headers.range);
  });

  // ---------------- style packs: a new editing style added from the dashboard (style.json + template.md + thumbnail + README)
  app.post('/api/studio/style-packs', manage, async (req, reply) => {
    const files: { name: string; data: Buffer }[] = [];
    const skipped: string[] = [];
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') continue;
      const data = await readCapped(part, PACK_LIMITS.each);
      if (data) files.push({ name: part.filename ?? '', data }); else skipped.push(part.filename ?? 'a file');
    }
    const r = parsePack(files);
    if (!r.ok) {
      const errors = [...r.errors, ...skipped.map((n) => `${n} is too large for a style pack and was skipped.`)];
      return reply.code(400).send({ error: errors.join('\n'), errors });
    }
    const { id, created } = await savePack(r.pack, req.user_!.id);
    await audit(req.user_!.id, created ? 'studio.style_pack.add' : 'studio.style_pack.replace', 'style_pack', id, { key: r.pack.key, name: r.pack.name });
    return { ok: true, id, key: r.pack.key, name: r.pack.name, created, ignored: [...r.pack.ignored, ...skipped] };
  });
  app.get('/api/studio/style-packs/:id/thumbnail', view, async (req, reply) => {
    const id = String((req.params as any).id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'Not found' });
    const t = await packThumb(id);
    if (!t) return reply.code(404).send({ error: 'Not found' });
    return reply.header('content-type', t.thumb_type).header('cache-control', 'private, max-age=3600').header('x-content-type-options', 'nosniff').send(t.thumb);
  });
  app.delete('/api/studio/style-packs/:id', manage, async (req, reply) => {
    const id = String((req.params as any).id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'Not found' });
    const pack = await one<any>('SELECT key, name FROM style_packs WHERE id=$1', [id]);
    if (!pack) return reply.code(404).send({ error: 'Not found' });
    const used = await one<any>(`SELECT code FROM production_jobs WHERE $1 = ANY(styles) AND status IN ('prompt_ready','with_claude') LIMIT 1`, [pack.key]);
    if (used) return reply.code(409).send({ error: `${used.code} is being made in this style. Change its style first.` });
    await deletePack(id);
    await audit(req.user_!.id, 'studio.style_pack.delete', 'style_pack', id, { key: pack.key, name: pack.name });
    return { ok: true };
  });

  // ---------------- machines: name + photos, so Claude can draw them in the video
  app.get('/api/studio/machines', view, async () => q(`SELECT id, name, notes, keywords, cardinality(photos) AS photos, cardinality(photo_links) AS photos_in_drive, created_at FROM machines ORDER BY created_at DESC`));
  app.post('/api/studio/machines', manage, async (req, reply) => {
    const fields: Record<string, string> = {};
    const photos: string[] = [];
    const id = crypto.randomUUID();
    const dir = path.join(mediaDir, 'studio', 'machines', id);
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') { fields[part.fieldname] = String(part.value ?? ''); continue; }
      if (IMAGE_EXT.test(part.filename) && photos.length < 8) photos.push((await saveUpload(part, path.join(dir, 'photos'))).dest);
      else part.file.resume();
    }
    if (!photos.length) return reply.code(400).send({ error: 'Add at least one photo of the machine (JPG or PNG)' });
    const name = (fields.name || '').trim().slice(0, 60);
    if (!name) return reply.code(400).send({ error: 'Give the machine a name' });
    const keywords = (fields.keywords ?? '').split(/[,;]/).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    const row = await one<any>(`INSERT INTO machines (id, name, notes, keywords, photos, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name`,
      [id, name, (fields.notes ?? '').slice(0, 1500) || null, keywords, photos, req.user_!.id]);
    setImmediate(() => uploadMachinePhotos(id).catch((e) => console.warn('[studio] machine photos', e.message)));
    await audit(req.user_!.id, 'studio.machine.add', 'machine', id, { name, photos: photos.length });
    return row;
  });
  app.delete('/api/studio/machines/:id', manage, async (req) => {
    await q(`DELETE FROM machines WHERE id=$1`, [(req.params as any).id]);
    return { ok: true };
  });
  app.get('/api/studio/machines/:id/photo/:n', view, async (req, reply) => {
    const { id, n } = req.params as any;
    const m = await one<any>('SELECT photos FROM machines WHERE id=$1', [id]);
    const p = (m?.photos ?? [])[Number(n)];
    return sendFile(reply, p, undefined, p?.endsWith('.png') ? 'image/png' : 'image/jpeg');
  });

  // ---------------- Drive
  app.post('/api/studio/drive/scan', manage, async () => ({ raw: await scanDrive(true), final: await scanFinals(true) }));
  app.post('/api/studio/drive/folders', manage, async (req, reply) => {
    const ws = await getWorkspace();
    if (!ws) return reply.code(400).send({ error: 'Connect Google Drive first' });
    return ws.local ? currentFolders(ws) : ensureFolders(ws);
  });

  // ---------------- Google Drive connection (OAuth)
  const wsRedirect = () => `${env.API_PUBLIC_URL}/api/integrations/workspace/callback`;
  app.get('/api/integrations/workspace/start', { preHandler: requirePermission('integrations.manage') }, async (req, reply) => {
    if (!env.GOOGLE_CLIENT_ID) return reply.code(400).send({ error: 'GOOGLE_CLIENT_ID not configured' });
    const state = randomToken();
    await q(`INSERT INTO oauth_states (state, provider, user_id) VALUES ($1,'workspace',$2)`, [state, req.user_!.id]);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: wsRedirect(), response_type: 'code', scope: WORKSPACE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    return reply.redirect(u.toString());
  });
  app.get('/api/integrations/workspace/callback', async (req, reply) => {
    const { code, state, error } = req.query as any;
    const back = (m: string, ok = false) => reply.redirect(`${env.WEB_ORIGIN}/integrations?${ok ? 'connected' : 'error'}=${encodeURIComponent(m)}`);
    const st = await one<any>(`DELETE FROM oauth_states WHERE state=$1 AND provider='workspace' AND created_at > now() - interval '15 minutes' RETURNING user_id`, [state ?? '']);
    if (!st) return back('Invalid or expired OAuth state');
    if (!code) return back(error ?? 'Authorization denied');
    try {
      const tok = await request<any>('https://oauth2.googleapis.com/token', { method: 'POST',
        form: { code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: wsRedirect(), grant_type: 'authorization_code' } });
      if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and connect again.');
      const scopes = String(tok.scope ?? '').split(' ');
      if (!scopes.some((x) => x.endsWith('/drive'))) throw new Error('Please tick the Google Drive permission on the Google screen.');
      const me = await request<any>('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } });
      const id = await saveWorkspace(me.email, me.name ?? me.email, tok.refresh_token, tok.access_token, tok.expires_in, scopes, st.user_id);
      await ensureFolders({ id, email: me.email, folders: {}, status: 'connected' }).catch((e) => console.warn('[drive] folders', e.message));
      await audit(st.user_id, 'workspace.connect', 'workspace', id, { email: me.email }, req.ip);
      return back(`Google Drive (${me.email})`, true);
    } catch (e) {
      return back((e as Error).message);
    }
  });
  app.delete('/api/integrations/workspace', { preHandler: requirePermission('integrations.manage') }, async (req) => {
    await q(`UPDATE workspace_connections SET status='disconnected', encrypted_refresh=NULL, encrypted_access=NULL, updated_at=now() WHERE status <> 'disconnected'`);
    await audit(req.user_!.id, 'workspace.disconnect', 'workspace', null, null, req.ip);
    return { ok: true };
  });
}
