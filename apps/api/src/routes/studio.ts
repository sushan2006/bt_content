import type { FastifyInstance, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { z } from 'zod';
import { env, mediaDir } from '../config.js';
import { one, q } from '../db/pool.js';
import { authenticate, requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { request } from '../lib/http.js';
import { currentFolders, driveList, driveStream, isDriveId, ensureFolders, getWorkspace, LOCAL_DRIVE, saveWorkspace, workspaceToken, WORKSPACE_SCOPES } from '../integrations/workspace.js';
import { addFile, advance, approve, createJob, deliverFinal, directorSettings, jobDir, recordSuggestion, reject, requestChanges, studioSettings, syncFinalsToDrive } from '../studio/pipeline.js';
import { BUILTIN, forgetStyleName, isValidStyle, listStyles, styleName } from '../studio/styles.js';
import { RULE_PLAIN, rulesFromEngine } from '../studio/rules.js';
import { scanDrive } from '../studio/intake.js';
import { studio } from '../studio/studioClient.js';

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CAD_EXT = /\.(obj|stl|glb|gltf|ply)$/i;
const safeName = (s: string) => s.replace(/[^\w.\-]+/g, '_').slice(-120);

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

async function streamDrive(reply: FastifyReply, fileId: string | null | undefined, range: string | undefined) {
  if (!fileId) return reply.code(404).send({ error: 'File not found' });
  // a path in the local drive folder (rendered before Google Drive was connected)
  if (!isDriveId(fileId) && fs.existsSync(fileId)) return sendFile(reply, fileId, range, 'video/mp4');
  const ws = await getWorkspace();
  if (!ws || ws.status !== 'connected') return reply.code(404).send({ error: 'The video is in Google Drive, but Drive is not connected' });
  if (ws.local) return sendFile(reply, fileId, range, 'video/mp4');
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

export async function studioRoutes(app: FastifyInstance) {
  const view = { preHandler: requirePermission('studio.view') };
  const manage = { preHandler: requirePermission('studio.manage') };
  const approvePerm = { preHandler: requirePermission('studio.approve') };
  const suggest = { preHandler: requirePermission('studio.suggest', 'studio.manage') };

  // ---------------- status + settings
  app.get('/api/studio/status', view, async () => {
    const health = await studio.health().catch((e) => ({ ok: false, error: (e as Error).message }));
    const g = await one<any>(`SELECT id, email, status, folders, last_error, last_scan_at, scopes FROM workspace_connections WHERE status <> 'disconnected' ORDER BY updated_at DESC LIMIT 1`);
    const loc = g ? null : await getWorkspace();
    const ws = g ?? (loc ? { id: 'local', email: 'Local drive folder', status: 'connected', local: true, folders: loc.folders, root: path.join(LOCAL_DRIVE, 'Content Studio') } : null);
    const accounts = await q<any>(`SELECT sa.platform_code, sa.display_name, sa.status, (SELECT scopes FROM social_account_tokens t WHERE t.social_account_id=sa.id ORDER BY updated_at DESC LIMIT 1) AS scopes
                                     FROM social_accounts sa WHERE sa.data_origin='live' AND sa.status <> 'disconnected'`);
    const can = (a: any) => a.platform_code === 'youtube' ? (a.scopes ?? []).some((s: string) => s.includes('youtube.upload')) : a.platform_code === 'instagram' ? (a.scopes ?? []).includes('instagram_content_publish') : (a.scopes ?? []).includes('pages_manage_posts');
    const { rules, recommended_variant } = await rulesFromEngine('live');
    return {
      service: health, workspace: ws, google_configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      publishing: accounts.map((a) => ({ platform: a.platform_code, account: a.display_name, status: a.status, can_publish: can(a) })),
      rules: rules.map((r) => ({ ...r, plain: RULE_PLAIN[r.code] ?? r.code })), recommended_variant,
      claude: !!(health as any)?.director?.claude, director: { ...(await directorSettings()), key: !!(health as any)?.director?.claude, gl: !!(health as any)?.director?.gl },
    };
  });

  app.get('/api/studio/settings', view, async () => studioSettings());
  app.put('/api/studio/settings', { preHandler: requirePermission('settings.manage', 'studio.manage') }, async (req) => {
    const emails = z.array(z.string().email()).max(30);
    const b = z.object({
      suggestion_emails: emails.optional(), approver_emails: emails.optional(), suggestion_wait_hours: z.number().min(0).max(168).optional(),
      review_mode: z.enum(['dashboard', 'email']).optional(), storage_mode: z.enum(['drive', 'local']).optional(), suggestion_window_hours: z.number().min(0).max(168).optional(),
      default_platforms: z.array(z.enum(['instagram', 'facebook', 'youtube'])).optional(), variants: z.array(z.string().refine(isValidStyle, 'unknown style')).min(1).max(8).optional(), local_drive: z.boolean().optional(),
      youtube_privacy: z.enum(['private', 'unlisted', 'public']).optional(), auto_publish_after_approval: z.boolean().optional(), drive_scan_minutes: z.number().min(1).max(120).optional(),
      glossary: z.array(z.string().max(60)).max(100).optional(),
      director: z.object({ planner: z.enum(['claude', 'rules']).optional(), model: z.enum(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']).optional(),
        helper_model: z.enum(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']).optional(), research: z.boolean().optional(),
        check_rounds: z.number().int().min(0).max(3).optional(), budget_usd: z.number().min(0.2).max(50).optional() }).partial().optional(),
      brand: z.object({ company_name: z.string().max(80).optional(), handle: z.string().max(60).optional(), tagline: z.string().max(120).optional(), cta: z.string().max(60).optional(),
        colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(), use_vector_logo: z.boolean().optional() }).partial().optional(),
    }).parse(req.body);
    const cur = await studioSettings();
    const next = { ...cur, ...b, approval_rule: 'any', brand: { ...(cur.brand ?? {}), ...(b.brand ?? {}) }, director: { ...(cur.director ?? {}), ...(b.director ?? {}) } };
    if (b.brand?.use_vector_logo === false) next.brand.logo_vector_path = null;
    await q(`INSERT INTO app_settings (key, value) VALUES ('studio',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify(next)]);
    await audit(req.user_!.id, 'studio.settings', 'app_settings', 'studio', b);
    return next;
  });

  app.post('/api/studio/brand/logo', { preHandler: requirePermission('settings.manage', 'studio.manage') }, async (req, reply) => {
    const part = await (req as any).file();
    if (!part || !IMAGE_EXT.test(part.filename)) return reply.code(400).send({ error: 'Upload a PNG or JPG logo' });
    const dir = path.join(mediaDir, 'studio', 'brand');
    const up = await saveUpload(part, dir);
    const info = await studio.logo(up.dest, dir);
    const cur = await studioSettings();
    const colors = Object.fromEntries(Object.entries(info.palette ?? {}).filter(([k]) => ['primary', 'accent', 'alert', 'dark', 'darker', 'light'].includes(k)));
    const next = { ...cur, brand: { ...(cur.brand ?? {}), logo_source: up.dest, logo_path: info.path, logo_light_path: info.light_path, logo_vector_path: null, colors: { ...(cur.brand?.colors ?? {}), ...colors } } };
    await q(`UPDATE app_settings SET value=$1, updated_at=now() WHERE key='studio'`, [JSON.stringify(next)]);
    return { ...next.brand, low_resolution: info.low_resolution, found_colors: info.palette?.found };
  });
  app.get('/api/studio/brand/logo', view, async (req, reply) => {
    const s = await studioSettings();
    const which = (req.query as any).light ? s.brand?.logo_light_path : s.brand?.logo_path;
    return sendFile(reply, which, undefined, 'image/png');
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
    if (!track || !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(track.name)) return reply.code(400).send({ error: 'Upload the music file (mp3, wav, m4a)' });
    if (!license && !fields.license_note) return reply.code(400).send({ error: 'A licence file or licence note is required. Only licensed music can be used.' });
    const src = z.enum(['pixabay', 'youtube_audio_library', 'meta_sound_collection', 'uppbeat', 'epidemic_sound', 'artlist', 'own', 'other']).parse(fields.source || 'other');
    const row = await one(`INSERT INTO music_tracks (title, artist, source, storage_path, license_path, license_note, source_url, content_id_registered, mood, added_by)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fields.title || path.parse(track.name).name, fields.artist || null, src, track.dest, license?.dest ?? fields.license_note ?? null, fields.license_note || null,
       fields.source_url || null, fields.content_id_registered === 'true', fields.mood || null, req.user_!.id]);
    await audit(req.user_!.id, 'studio.music.add', 'music_track', (row as any).id, { source: src });
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

  // ---------------- jobs
  app.get('/api/studio/jobs', view, async (req) => {
    const origin = (req.query as any).origin === 'demo' ? 'demo' : 'live';
    return q(`SELECT j.id, j.code, j.title, j.status, j.status_detail, j.revision, j.source, j.platforms, j.approved_variant, j.recommended_variant, j.created_at, j.updated_at, j.publish_at, j.styles, j.completed_at, j.final_drive_link,
                     ci.code AS content_code, (SELECT count(*)::int FROM production_files f WHERE f.job_id=j.id AND f.kind='take') AS takes,
                     (SELECT coalesce(array_agg(DISTINCT pj.platform_code), '{}') FROM publish_jobs pj WHERE pj.job_id=j.id AND pj.status='published') AS published_on,
                     (SELECT previews[2] IS NOT NULL FROM production_versions v WHERE v.job_id=j.id AND v.revision=j.revision AND v.variant=j.recommended_variant AND v.aspect='9:16') AS has_preview,
                     (SELECT id FROM production_versions v WHERE v.job_id=j.id AND v.revision=j.revision AND v.variant=coalesce(j.approved_variant, j.recommended_variant) AND v.aspect='9:16') AS cover_version_id
                FROM production_jobs j LEFT JOIN content_items ci ON ci.id=j.content_item_id WHERE j.data_origin=$1 ORDER BY j.created_at DESC LIMIT 200`, [origin]);
  });

  const briefSchema = z.object({
    headline: z.string().max(120).optional(), headline_highlight: z.array(z.string()).optional(), script: z.string().max(20000).optional(),
    speaker_name: z.string().max(60).optional(), speaker_role: z.string().max(80).optional(), cta: z.string().max(60).optional(), tagline: z.string().max(120).optional(),
    keywords: z.array(z.string().max(40)).max(20).optional(), hashtags: z.array(z.string().max(40)).max(15).optional(), notes: z.string().max(4000).optional(),
    language: z.string().max(8).optional(), skip_suggestions: z.boolean().optional(), spellings: z.string().max(1000).optional(), glossary: z.array(z.string().max(60)).max(50).optional(), youtube_landscape: z.boolean().optional(), flow_title: z.string().max(40).optional(),
  }).partial();

  app.post('/api/studio/jobs', manage, async (req) => {
    const b = z.object({ title: z.string().min(2).max(140), brief: briefSchema.default({}), platforms: z.array(z.enum(['instagram', 'facebook', 'youtube'])).min(1).optional(),
      music_track_id: z.string().uuid().nullish(), publish_at: z.string().datetime().nullish(),
      styles: z.array(z.string().refine(isValidStyle, 'unknown style')).max(8).optional(), machine_id: z.string().uuid().nullish(),
      machine_ids: z.array(z.string().uuid()).max(6).optional() }).parse(req.body);
    const job = await createJob({ title: b.title, brief: b.brief, source: 'upload', platforms: b.platforms, musicTrackId: b.music_track_id ?? null, publishAt: b.publish_at ?? null, userId: req.user_!.id,
      styles: b.styles ?? null, machineIds: b.machine_ids ?? (b.machine_id ? [b.machine_id] : []) });
    await audit(req.user_!.id, 'studio.job.create', 'production_job', job.id, { title: b.title });
    return job;
  });

  app.patch('/api/studio/jobs/:id', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (['publishing', 'published'].includes(job.status)) return reply.code(409).send({ error: 'Already published' });
    const b = z.object({ title: z.string().min(2).max(140).optional(), brief: briefSchema.optional(), platforms: z.array(z.enum(['instagram', 'facebook', 'youtube'])).min(1).optional(),
      music_track_id: z.string().uuid().nullish(), publish_at: z.string().datetime().nullish(),
      styles: z.array(z.string().refine(isValidStyle, 'unknown style')).max(8).optional(), machine_id: z.string().uuid().nullish(),
      machine_ids: z.array(z.string().uuid()).max(6).optional() }).parse(req.body);
    if (b.styles) await q(`UPDATE production_jobs SET styles=$2 WHERE id=$1`, [id, b.styles]);
    const mids = b.machine_ids ?? ('machine_id' in b ? (b.machine_id ? [b.machine_id] : []) : null);
    if (mids) await q(`UPDATE production_jobs SET machine_ids=$2::uuid[], machine_id=$3 WHERE id=$1`, [id, mids, mids[0] ?? null]);
    return one(`UPDATE production_jobs SET title=coalesce($2,title), brief=CASE WHEN $3::jsonb IS NULL THEN brief ELSE brief || $3::jsonb END, platforms=coalesce($4,platforms),
                  music_track_id=CASE WHEN $5::boolean THEN $6::uuid ELSE music_track_id END, publish_at=CASE WHEN $7::boolean THEN $8::timestamptz ELSE publish_at END, updated_at=now()
                WHERE id=$1 RETURNING *`,
      [id, b.title ?? null, b.brief ? JSON.stringify(b.brief) : null, b.platforms ?? null, 'music_track_id' in b, b.music_track_id ?? null, 'publish_at' in b, b.publish_at ?? null]);
  });

  app.post('/api/studio/jobs/:id/files', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const out: any[] = [];
    const fields: Record<string, string> = {};
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') { fields[part.fieldname] = String(part.value ?? ''); continue; }
      const isVideo = VIDEO_EXT.test(part.filename), isImage = IMAGE_EXT.test(part.filename);
      if (!isVideo && !isImage) { part.file.resume(); continue; }
      const up = await saveUpload(part, path.join(jobDir(job.code), isVideo ? 'takes' : 'images'));
      if (isVideo) {
        const n = ((await one<any>(`SELECT count(*)::int AS n FROM production_files WHERE job_id=$1 AND kind='take'`, [id]))!.n) + 1;
        out.push(await addFile(id, { kind: 'take', take_id: `T${n}`, name: up.name, storage_path: up.dest, md5: up.md5, size: up.size }));
      } else {
        const tags = [...(fields.tags ?? '').split(/[,;]/), ...path.parse(up.name).name.split(/[^a-zA-Z0-9]+/)].map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
        out.push(await addFile(id, { kind: 'image', name: up.name, storage_path: up.dest, md5: up.md5, size: up.size, tags: [...new Set(tags)] }));
      }
    }
    return out;
  });

  app.delete('/api/studio/jobs/:id/files/:fileId', manage, async (req) => {
    const { id, fileId } = req.params as any;
    await q(`DELETE FROM production_files WHERE id=$2 AND job_id=$1 AND (SELECT status FROM production_jobs WHERE id=$1) IN ('new','failed')`, [id, fileId]);
    return { ok: true };
  });

  app.post('/api/studio/jobs/:id/start', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    if (job.status !== 'new') return reply.code(409).send({ error: `Already ${job.status}` });
    const takes = (await one<any>(`SELECT count(*)::int AS n FROM production_files WHERE job_id=$1 AND kind='take'`, [id]))!.n;
    if (!takes) return reply.code(400).send({ error: 'Upload at least one take first' });
    setImmediate(() => advance(id).catch(console.error));
    await audit(req.user_!.id, 'studio.job.start', 'production_job', id);
    return { started: true };
  });

  app.post('/api/studio/jobs/:id/retry', manage, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const versions = (await one<any>(`SELECT count(*)::int AS n FROM production_versions WHERE job_id=$1 AND revision=$2`, [id, job.revision]))!.n;
    const status = !job.analysis ? 'analyzing' : !versions ? 'planning' : 'rendering';
    await q(`UPDATE production_jobs SET status=$2, error=NULL, status_detail='Retrying', updated_at=now() WHERE id=$1`, [id, status]);
    setImmediate(() => advance(id).catch(console.error));
    return { status };
  });

  app.post('/api/studio/jobs/:id/replan', manage, async (req, reply) => {
    // re-plan + re-render the current revision (e.g. after changing brand settings or music)
    const { id } = req.params as any;
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [id]);
    if (!job?.analysis) return reply.code(400).send({ error: 'The takes have not been analysed yet' });
    if (['publishing', 'published'].includes(job.status)) return reply.code(409).send({ error: 'Already published' });
    await q(`UPDATE production_jobs SET status='planning', status_detail='Re-planning with the current settings', error=NULL, updated_at=now() WHERE id=$1`, [id]);
    setImmediate(() => advance(id).catch(console.error));
    return { ok: true };
  });

  app.delete('/api/studio/jobs/:id', manage, async (req) => {
    const { id } = req.params as any;
    await q(`UPDATE production_jobs SET status='cancelled', status_detail='Cancelled', updated_at=now() WHERE id=$1 AND status NOT IN ('publishing','published')`, [id]);
    await q(`UPDATE publish_jobs SET status='cancelled' WHERE job_id=$1 AND status='scheduled'`, [id]);
    await audit(req.user_!.id, 'studio.job.cancel', 'production_job', id);
    return { ok: true };
  });

  app.get('/api/studio/jobs/:id', view, async (req, reply) => {
    const { id } = req.params as any;
    const job = await one<any>(`SELECT j.*, ci.code AS content_code FROM production_jobs j LEFT JOIN content_items ci ON ci.id=j.content_item_id WHERE j.id=$1`, [id]);
    if (!job) return reply.code(404).send({ error: 'Not found' });
    const files = await q(`SELECT id, kind, take_id, name, size_bytes, duration_sec, tags, meta, drive_file_id, created_at FROM production_files WHERE job_id=$1 ORDER BY kind, take_id, created_at`, [id]);
    const versions = await q<any>(`SELECT id, revision, variant, aspect, label, summary, notes, status, qc, drive_link, render_seconds, error, previews, created_at, updated_at,
                                          plan->'metadata' AS metadata, plan->'rules' AS rules, planner, direction->'notes' AS claude_notes FROM production_versions WHERE job_id=$1 ORDER BY revision DESC, aspect, label`, [id]);
    for (const v of versions) { v.preview_count = v.previews?.length ?? 0; delete v.previews; v.name = await styleName(v.variant); }
    const suggestions = await q(`SELECT * FROM production_suggestions WHERE job_id=$1 ORDER BY received_at`, [id]);
    const emails = await q(`SELECT t.id, t.kind, t.revision, t.to_emails, t.subject, t.status, t.error, t.sent_at,
                                   (SELECT coalesce(json_agg(json_build_object('from', r.from_email, 'body', left(r.body, 1200), 'at', r.received_at, 'classification', r.classification) ORDER BY r.received_at), '[]') FROM email_replies r WHERE r.thread_id=t.id) AS replies
                              FROM email_threads t WHERE t.job_id=$1 ORDER BY t.created_at`, [id]);
    const decisions = await q(`SELECT d.*, u.full_name AS by_user_name FROM approval_decisions d LEFT JOIN users u ON u.id=d.by_user WHERE d.job_id=$1 ORDER BY d.created_at`, [id]);
    const publishing = await q(`SELECT id, platform_code, format, scheduled_at, status, permalink, error, attempts, title, caption, version_id, updated_at FROM publish_jobs WHERE job_id=$1 ORDER BY platform_code`, [id]);
    const lines = (job.analysis?.selection?.lines ?? []).map((l: any) => ({ index: l.index, text: l.text, take_id: l.take_id, reason: l.reason,
      candidates: l.candidates.map((c: any) => ({ take_id: c.take_id, score: c.score, text: c.text })) }));
    const takes = (job.analysis?.takes ?? []).map((t: any) => ({ take_id: t.take_id, duration: t.duration, noise_db: t.noise_db, faces_found: t.faces_found, on_camera: t.on_camera ?? null,
      sentences: t.sentences.length }));
    delete job.analysis;
    job.style_names = await Promise.all((job.styles ?? []).map((k: string) => styleName(k)));
    job.approved_name = job.approved_variant ? await styleName(job.approved_variant) : null;
    job.recommended_name = job.recommended_variant ? await styleName(job.recommended_variant) : null;
    job.machines = (job.machine_ids ?? []).length ? await q(`SELECT id, name, status, error FROM machines WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`, [job.machine_ids]) : [];
    job.machine = job.machines[0] ?? null;
    const keys = (job.director?.assets ?? []).map((a: any) => a.key).filter(Boolean);
    const assets = await q(`SELECT id, asset_id, name, parts, glb_path IS NOT NULL AS has_glb, preview_path IS NOT NULL AS has_preview FROM studio_assets
                             WHERE source_job_id=$1 OR spec_key = ANY($2::text[]) ORDER BY created_at`, [id, keys]);
    return { job, files, versions, suggestions, emails, decisions, publishing, lines, takes, assets };
  });

  app.post('/api/studio/jobs/:id/suggestions', suggest, async (req) => {
    const { id } = req.params as any;
    const b = z.object({ text: z.string().min(1).max(4000), from_email: z.string().email().optional() }).parse(req.body);
    const s = await recordSuggestion(id, b.from_email ?? req.user_!.email, b.text, 'app');
    setImmediate(() => advance(id).catch(console.error));
    return s;
  });
  app.post('/api/studio/jobs/:id/skip-suggestions', manage, async (req) => {
    const { id } = req.params as any;
    await q(`UPDATE production_jobs SET brief = brief || '{"skip_suggestions":true}'::jsonb, updated_at=now() - interval '1 minute' WHERE id=$1`, [id]);
    setImmediate(() => advance(id).catch(console.error));
    return { ok: true };
  });

  app.post('/api/studio/jobs/:id/approve', approvePerm, async (req, reply) => {
    const b = z.object({ variant: z.string().refine(isValidStyle).optional(), note: z.string().max(1000).optional() }).parse(req.body ?? {});
    try { await approve((req.params as any).id, b.variant ?? null, { email: req.user_!.email, userId: req.user_!.id }, 'app', b.note); return { ok: true }; }
    catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.post('/api/studio/jobs/:id/reject', approvePerm, async (req) => {
    const b = z.object({ note: z.string().max(1000).optional() }).parse(req.body ?? {});
    await reject((req.params as any).id, { email: req.user_!.email, userId: req.user_!.id }, 'app', b.note);
    return { ok: true };
  });
  app.post('/api/studio/jobs/:id/changes', approvePerm, async (req) => {
    const b = z.object({ text: z.string().min(2).max(4000) }).parse(req.body);
    return requestChanges((req.params as any).id, b.text, { email: req.user_!.email, userId: req.user_!.id }, 'app');
  });
  /** Test an approver's email reply without Gmail: the text goes through the same reader as a real reply. */
  app.post('/api/studio/jobs/:id/simulate-reply', approvePerm, async (req, reply) => {
    const { id } = req.params as any;
    const b = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const c = await studio.classifyReply(b.text);
    const vrow = c.version ? await one<any>(`SELECT variant FROM production_versions WHERE job_id=$1 AND label=$2 AND aspect='9:16' ORDER BY revision DESC LIMIT 1`, [id, c.version]) : null;
    const variant = vrow?.variant ?? null;
    const by = { email: req.user_!.email, userId: req.user_!.id };
    try {
      if (c.decision === 'approve') await approve(id, variant, by, 'app', b.text);
      else if (c.decision === 'reject') await reject(id, by, 'app', b.text);
      else if (c.decision === 'changes') await requestChanges(id, c.text, by, 'app');
    } catch (e) { return reply.code(409).send({ error: (e as Error).message, understood: c }); }
    return { understood: c };
  });

  // ---------------- versions: video, previews, storyboard
  app.get('/api/studio/versions/:id/video', view, async (req, reply) => {
    const v = await one<any>('SELECT output_path, drive_file_id FROM production_versions WHERE id=$1', [(req.params as any).id]);
    if ((req.query as any).download) reply.header('content-disposition', `attachment; filename="${path.basename(v?.output_path ?? 'video.mp4')}"`);
    if (v?.output_path && fs.existsSync(v.output_path)) return sendFile(reply, v.output_path, req.headers.range, 'video/mp4');
    // the local copy was removed after upload: play it straight from Google Drive
    return streamDrive(reply, v?.drive_file_id, req.headers.range);
  });
  app.get('/api/studio/versions/:id/preview/:n', view, async (req, reply) => {
    const { id, n } = req.params as any;
    const v = await one<any>('SELECT previews FROM production_versions WHERE id=$1', [id]);
    return sendFile(reply, v?.previews?.[Number(n)], undefined, 'image/jpeg');
  });
  app.get('/api/studio/versions/:id/plan', view, async (req) => one(`SELECT plan, summary FROM production_versions WHERE id=$1`, [(req.params as any).id]));
  app.post('/api/studio/versions/:id/storyboard', view, async (req, reply) => {
    const { id } = req.params as any;
    const v = await one<any>(`SELECT v.*, j.code FROM production_versions v JOIN production_jobs j ON j.id=v.job_id WHERE v.id=$1`, [id]);
    if (!v) return reply.code(404).send({ error: 'Not found' });
    const n = Math.min(16, Math.max(4, Number((req.body as any)?.frames ?? 8)));
    const total = v.plan.clips.reduce((s: number, c: any) => s + c.t_out - c.t_in, 0) + (v.plan.end_card_seconds ?? 0);
    const times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * total / n) * 100) / 100);
    const out = path.join(jobDir(v.code), `r${v.revision}`, `storyboard_${v.label}_${v.aspect.replace(':', 'x')}`);
    const r = await studio.storyboard({ plan: v.plan, times, out_dir: out, width: 360 });
    await q(`UPDATE production_versions SET qc = coalesce(qc,'{}'::jsonb) || $2 WHERE id=$1`, [id, JSON.stringify({ storyboard: r.files, storyboard_times: times })]);
    return { times, count: r.files.length };
  });
  app.get('/api/studio/versions/:id/storyboard/:n', view, async (req, reply) => {
    const { id, n } = req.params as any;
    const v = await one<any>('SELECT qc FROM production_versions WHERE id=$1', [id]);
    return sendFile(reply, v?.qc?.storyboard?.[Number(n)], undefined, 'image/jpeg');
  });
  app.post('/api/studio/publish-jobs/:id/retry', manage, async (req) => {
    await q(`UPDATE publish_jobs SET status='scheduled', scheduled_at=now(), error=NULL WHERE id=$1 AND status IN ('failed','manual')`, [(req.params as any).id]);
    await q(`UPDATE production_jobs SET status='publishing' WHERE id=(SELECT job_id FROM publish_jobs WHERE id=$1) AND status='published'`, [(req.params as any).id]);
    return { ok: true };
  });

  // ---------------- editing styles (built-in + learned from reference videos)
  app.get('/api/studio/styles', view, async () => listStyles());
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
    const row = await one<any>(`INSERT INTO style_profiles (name, source_name, source_path, status, created_by) VALUES ($1,$2,$3,'analysing',$4) RETURNING *`, [name, up.name, up.dest, req.user_!.id]);
    setImmediate(async () => {
      try {
        const ds = await directorSettings();
        const r = await studio.extractStyle(up.dest, name, undefined, { card: ds.planner === 'claude', model: ds.helper_model });
        await q(`UPDATE style_profiles SET base=$2, params=$3, report=$4, measured=$5, summary=$6, card=$7, status='ready', updated_at=now() WHERE id=$1`,
          [row.id, r.base, JSON.stringify(r.params), JSON.stringify(r.report), JSON.stringify(r.measured), r.summary, r.card ? JSON.stringify(r.card) : null]);
      } catch (e) {
        await q(`UPDATE style_profiles SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [row.id, (e as Error).message.slice(0, 800)]);
      }
    });
    await audit(req.user_!.id, 'studio.style.add', 'style_profile', row.id, { name });
    return row;
  });
  app.patch('/api/studio/styles/:id', manage, async (req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), base: z.enum(['explainer3d', 'hype', 'cinematic', 'minimal']).optional(),
      card: z.record(z.string(), z.any()).optional() }).parse(req.body);
    forgetStyleName(`profile:${(req.params as any).id}`);
    return one(`UPDATE style_profiles SET name=coalesce($2,name), base=coalesce($3,base), card=coalesce($4::jsonb, card), summary=coalesce($5, summary), updated_at=now() WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.name ?? null, b.base ?? null, b.card ? JSON.stringify(b.card) : null, typeof b.card?.summary === 'string' ? b.card.summary : null]);
  });
  app.delete('/api/studio/styles/:id', manage, async (req) => {
    await q(`DELETE FROM style_profiles WHERE id=$1`, [(req.params as any).id]);
    return { ok: true };
  });
  app.get('/api/studio/styles/:id/video', view, async (req, reply) => {
    const p = await one<any>('SELECT source_path FROM style_profiles WHERE id=$1', [(req.params as any).id]);
    return sendFile(reply, p?.source_path, req.headers.range, 'video/mp4');
  });

  // ---------------- machine library: photos of your machines -> 3D models used in the videos
  app.get('/api/studio/machines', view, async () => q(`SELECT id, name, tagline, keywords, status, error, meta->'previews' AS previews, meta->>'kind' AS kind, method, (meta->>'glb') IS NOT NULL AS has_glb,
    meta->'usage'->>'cost_usd' AS cost_usd, cardinality(photos) AS photos, created_at FROM machines ORDER BY created_at DESC`));
  app.post('/api/studio/machines', manage, async (req, reply) => {
    const fields: Record<string, string> = {};
    const photos: string[] = [];
    let cad: string | null = null;
    const id = crypto.randomUUID();
    const dir = path.join(mediaDir, 'studio', 'machines', id);
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') { fields[part.fieldname] = String(part.value ?? ''); continue; }
      if (IMAGE_EXT.test(part.filename) && photos.length < 6) photos.push((await saveUpload(part, path.join(dir, 'photos'))).dest);
      else if (CAD_EXT.test(part.filename) && !cad) cad = (await saveUpload(part, path.join(dir, 'cad'))).dest;
      else part.file.resume();
    }
    if (!photos.length && !cad) return reply.code(400).send({ error: 'Add at least one photo of the machine (JPG or PNG), or a 3D file (OBJ / STL / GLB)' });
    const name = (fields.name || 'Machine').slice(0, 60);
    const keywords = (fields.keywords ?? '').split(/[,;]/).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    const row = await one<any>(`INSERT INTO machines (id, name, tagline, keywords, photos, cad_path, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'building',$7) RETURNING *`,
      [id, name, fields.tagline || null, keywords, photos, cad, req.user_!.id]);
    setImmediate(async () => {
      try {
        const ds = await directorSettings();
        const method = cad ? 'relief' : (fields.method === 'relief' || ds.planner !== 'claude') ? 'relief' : 'auto';
        const meta = await studio.buildMachine({ images: photos, out_dir: path.join(dir, 'model'), name, cad, method, notes: (fields.notes ?? '').slice(0, 1500), model: ds.model });
        await q(`UPDATE machines SET meta=$2, status='ready', method=$3, updated_at=now() WHERE id=$1`, [id, JSON.stringify(meta), meta.kind === 'kit' ? 'claude' : 'relief']);
      } catch (e) {
        await q(`UPDATE machines SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [id, (e as Error).message.slice(0, 800)]);
      }
    });
    await audit(req.user_!.id, 'studio.machine.add', 'machine', id, { name, photos: photos.length });
    return row;
  });
  app.patch('/api/studio/machines/:id', manage, async (req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), tagline: z.string().max(80).nullish(), keywords: z.array(z.string().max(30)).max(12).optional() }).parse(req.body);
    return one(`UPDATE machines SET name=coalesce($2,name), tagline=CASE WHEN $3::boolean THEN $4 ELSE tagline END, keywords=coalesce($5,keywords), updated_at=now() WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.name ?? null, 'tagline' in b, b.tagline ?? null, b.keywords ?? null]);
  });
  app.delete('/api/studio/machines/:id', manage, async (req) => {
    await q(`DELETE FROM machines WHERE id=$1`, [(req.params as any).id]);
    return { ok: true };
  });
  app.get('/api/studio/machines/:id/preview', view, async (req, reply) => {
    const m = await one<any>('SELECT meta FROM machines WHERE id=$1', [(req.params as any).id]);
    return sendFile(reply, m?.meta?.previews?.[0], undefined, 'image/jpeg');
  });
  app.get('/api/studio/machines/:id/glb', view, async (req, reply) => {
    const m = await one<any>('SELECT name, meta FROM machines WHERE id=$1', [(req.params as any).id]);
    if (!m?.meta?.glb) return reply.code(404).send({ error: 'No 3D file for this machine (rebuild it with Claude to get a .glb)' });
    reply.header('content-disposition', `attachment; filename="${safeName(m.name)}.glb"`);
    return sendFile(reply, m.meta.glb, undefined, 'model/gltf-binary');
  });

  // ---------------- 3D assets Claude built for earlier videos (reused by later videos)
  app.get('/api/studio/assets', view, async () => q(`SELECT DISTINCT ON (a.asset_id) a.id, a.asset_id, a.name, a.parts, a.created_at, a.glb_path IS NOT NULL AS has_glb, a.preview_path IS NOT NULL AS has_preview,
      a.drive_file_id IS NOT NULL AS in_drive, j.code AS job_code FROM studio_assets a LEFT JOIN production_jobs j ON j.id=a.source_job_id ORDER BY a.asset_id, a.created_at DESC`));
  app.get('/api/studio/assets/:id/preview', view, async (req, reply) => {
    const a = await one<any>('SELECT preview_path FROM studio_assets WHERE id=$1', [(req.params as any).id]);
    return sendFile(reply, a?.preview_path, undefined, 'image/jpeg');
  });
  app.get('/api/studio/assets/:id/glb', view, async (req, reply) => {
    const a = await one<any>('SELECT asset_id, glb_path FROM studio_assets WHERE id=$1', [(req.params as any).id]);
    reply.header('content-disposition', `attachment; filename="${safeName(a?.asset_id ?? 'model')}.glb"`);
    return sendFile(reply, a?.glb_path, undefined, 'model/gltf-binary');
  });
  app.delete('/api/studio/assets/:id', manage, async (req) => {
    await q(`DELETE FROM studio_assets WHERE asset_id=(SELECT asset_id FROM studio_assets WHERE id=$1)`, [(req.params as any).id]);
    return { ok: true };
  });

  app.get('/api/studio/machines/:id/photo/:n', view, async (req, reply) => {
    const { id, n } = req.params as any;
    const m = await one<any>('SELECT photos, meta FROM machines WHERE id=$1', [id]);
    const p = (m?.meta?.cutouts ?? m?.photos ?? [])[Number(n)];
    return sendFile(reply, p, undefined, p?.endsWith('.png') ? 'image/png' : 'image/jpeg');
  });

  // ---------------- completed videos: every approved job (the database is the record), plus any other video found in content_final
  app.get('/api/studio/completed', view, async () => {
    const ws = await getWorkspace();
    const google = !!ws && !ws.local && ws.status === 'connected';
    const jobs = await q<any>(`SELECT j.id, j.code, j.title, j.approved_variant, j.approved_by_email, j.approved_at, j.completed_at, j.final_drive_file_id, j.final_drive_link,
                                      j.final_path, j.final_error, j.status, j.platforms,
                                      (SELECT array_agg(DISTINCT pj.platform_code) FROM publish_jobs pj WHERE pj.job_id=j.id AND pj.status='published') AS published_on
                                 FROM production_jobs j WHERE j.data_origin='live' AND (j.completed_at IS NOT NULL OR j.final_drive_file_id IS NOT NULL)
                                ORDER BY coalesce(j.completed_at, j.approved_at) DESC LIMIT 200`);
    let files: any[] = [];
    let error: string | null = null;
    if (ws && ws.status === 'connected') {
      try {
        const token = await workspaceToken(ws);
        const folders = await currentFolders(ws);
        files = (await driveList(folders.final, token)).filter((f) => VIDEO_EXT.test(f.name) || f.mimeType.startsWith('video/'));
      } catch (e) { error = (e as Error).message; }
    }
    const items: any[] = [];
    for (const j of jobs) {
      const inGoogle = isDriveId(j.final_drive_file_id);
      const file = files.find((f) => f.id === j.final_drive_file_id);
      const localFile = [j.final_path, inGoogle ? null : j.final_drive_file_id].find((p) => p && fs.existsSync(p)) as string | undefined;
      items.push({
        key: j.id, name: file?.name ?? (localFile ? path.basename(localFile) : `${j.code} ${j.title}.mp4`),
        size: Number(file?.size ?? (localFile ? fs.statSync(localFile).size : 0)), modified: j.completed_at,
        drive_link: inGoogle ? j.final_drive_link : null,
        where: inGoogle ? 'Google Drive › content_final' : j.final_drive_file_id ? 'Local drive folder (not in Google Drive yet)' : 'This computer only',
        in_google: inGoogle, can_send: google && !inGoogle, stream: `/api/studio/jobs/${j.id}/final`,
        job: { ...j, style_name: await styleName(j.approved_variant) },
      });
    }
    // videos someone put in content_final by hand
    for (const f of files) {
      if (jobs.some((j) => j.final_drive_file_id === f.id)) continue;
      items.push({ key: f.id, name: f.name, size: Number(f.size ?? 0), modified: f.modifiedTime, drive_link: ws?.local ? null : f.webViewLink,
        where: ws?.local ? 'Local drive folder' : 'Google Drive › content_final', in_google: !ws?.local, can_send: false,
        stream: `/api/studio/drive/stream?id=${encodeURIComponent(f.id)}`, job: null });
    }
    return {
      folder: ws ? (ws.local ? path.join(LOCAL_DRIVE, 'Content Studio', 'content_final') : `Google Drive (${ws.email}) › content_final`) : null,
      drive: ws ? { google, email: ws.email } : null, items, error,
      not_in_drive: items.filter((i) => i.can_send).length,
    };
  });
  /** Send every completed video that is not in Google Drive yet (approved before Drive was connected, or a failed upload). */
  app.post('/api/studio/completed/sync', manage, async (req) => {
    const r = await syncFinalsToDrive();
    await audit(req.user_!.id, 'studio.final.sync', 'production_job', null, r);
    return r;
  });
  app.post('/api/studio/jobs/:id/deliver', manage, async (req, reply) => {
    const job = await one<any>('SELECT * FROM production_jobs WHERE id=$1', [(req.params as any).id]);
    if (!job?.approved_variant) return reply.code(400).send({ error: 'This video has not been approved yet' });
    const r = await deliverFinal(job);
    if (!r.ok) return reply.code(502).send({ error: r.error });
    return r;
  });
  app.get('/api/studio/drive/stream', view, async (req, reply) => {
    const id = String((req.query as any).id ?? '');
    const ws = await getWorkspace();
    if (!ws) return reply.code(404).send({ error: 'Drive not connected' });
    if (ws.local) {
      const full = path.resolve(id);
      if (!full.startsWith(path.resolve(LOCAL_DRIVE))) return reply.code(403).send({ error: 'Outside the drive folder' });
      return sendFile(reply, full, req.headers.range, 'video/mp4');
    }
    const r = await driveStream(id, await workspaceToken(ws), req.headers.range);
    if (!r?.body) return reply.code(r?.status ?? 404).send({ error: 'Could not read the file from Drive' });
    reply.code(r.status);
    for (const [k, v] of Object.entries(r.headers)) reply.header(k, v);
    return reply.send(r.body);
  });
  app.get('/api/studio/jobs/:id/final', view, async (req, reply) => {
    const j = await one<any>('SELECT final_path, final_drive_file_id FROM production_jobs WHERE id=$1', [(req.params as any).id]);
    if (j?.final_path && fs.existsSync(j.final_path)) return sendFile(reply, j.final_path, req.headers.range, 'video/mp4');
    if (!j?.final_drive_file_id) return reply.code(404).send({ error: 'The final video is not stored anywhere yet' });
    return streamDrive(reply, j?.final_drive_file_id, req.headers.range);
  });

  // ---------------- Drive
  app.post('/api/studio/drive/scan', manage, async () => scanDrive(true));
  app.post('/api/studio/drive/folders', manage, async (req, reply) => {
    const ws = await getWorkspace();
    if (!ws) return reply.code(400).send({ error: 'Connect Google Drive & Gmail first' });
    return ensureFolders(ws);
  });

  // ---------------- Google Drive + Gmail connection (OAuth)
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
      const missing = (process.env.WORKSPACE_GMAIL === '1' ? ['drive', 'gmail.send', 'gmail.readonly'] : ['drive']).filter((s) => !scopes.some((x) => x.endsWith(s)));
      if (missing.length) throw new Error(`Please tick every permission on the Google screen (missing: ${missing.join(', ')}).`);
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
