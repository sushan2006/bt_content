import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { mediaDir } from '../config.js';
import { one, q } from '../db/pool.js';
import { authenticate, requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { enqueue } from '../jobs/queue.js';
import { explainPublication } from '../intelligence/explain.js';
import { loadDataset } from '../intelligence/dataset.js';
import { percentileRank } from '../intelligence/stats.js';

export const originOf = (req: FastifyRequest) => ((req.query as any)?.origin === 'demo' ? 'demo' : 'live');
const canSeeAll = (req: FastifyRequest) => req.user_!.permissions.includes('content.view_all');

const contentBody = z.object({
  title: z.string().min(1), description: z.string().nullish(), category_id: z.number().int().nullish(), campaign_id: z.string().uuid().nullish(),
  product: z.string().nullish(), topic: z.string().nullish(), language: z.string().nullish(), tags: z.array(z.string()).optional(),
  business_objective: z.enum(['brand_awareness', 'product_awareness', 'engagement', 'lead_generation']).nullish(), owner_id: z.string().uuid().nullish(),
});

export async function contentRoutes(app: FastifyInstance) {
  // ---------- Categories & campaigns
  app.get('/api/categories', { preHandler: authenticate }, async () => q('SELECT * FROM content_categories ORDER BY group_code, name'));
  app.post('/api/categories', { preHandler: requirePermission('categories.manage') }, async (req) => {
    const b = z.object({ group_code: z.string().default('purpose'), code: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), description: z.string().nullish() }).parse(req.body);
    const r = await one('INSERT INTO content_categories (group_code, code, name, description) VALUES ($1,$2,$3,$4) RETURNING *', [b.group_code, b.code, b.name, b.description ?? null]);
    await audit(req.user_!.id, 'category.create', 'category', String((r as any).id), b);
    return r;
  });
  app.put('/api/categories/:id', { preHandler: requirePermission('categories.manage') }, async (req) => {
    const b = z.object({ name: z.string(), description: z.string().nullish(), is_active: z.boolean().default(true) }).parse(req.body);
    return one('UPDATE content_categories SET name=$2, description=$3, is_active=$4 WHERE id=$1 RETURNING *', [(req.params as any).id, b.name, b.description ?? null, b.is_active]);
  });
  app.get('/api/campaigns', { preHandler: authenticate }, async () => q('SELECT * FROM campaigns ORDER BY created_at DESC'));
  app.post('/api/campaigns', { preHandler: requirePermission('campaigns.manage') }, async (req) => {
    const b = z.object({ code: z.string().regex(/^[a-z0-9_\-]+$/i), name: z.string(), objective: z.enum(['brand_awareness', 'product_awareness', 'engagement', 'lead_generation']).nullish(),
      start_date: z.string().nullish(), end_date: z.string().nullish(), description: z.string().nullish() }).parse(req.body);
    return one(`INSERT INTO campaigns (code, name, objective, start_date, end_date, description, created_by) VALUES (lower($1),$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.code, b.name, b.objective ?? null, b.start_date ?? null, b.end_date ?? null, b.description ?? null, req.user_!.id]);
  });

  // ---------- Content library
  app.get('/api/content', { preHandler: requirePermission('content.view_all', 'content.view_assigned') }, async (req) => {
    const f = req.query as any;
    const origin = originOf(req);
    const params: any[] = [origin];
    const where = [`ci.data_origin = $1`];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (!canSeeAll(req)) add('ci.owner_id = ?', req.user_!.id);
    if (f.q) add(`(ci.title ILIKE ? OR ci.product ILIKE $${params.length + 1} OR ci.topic ILIKE $${params.length + 1} OR ci.code ILIKE $${params.length + 1})`, `%${f.q}%`);
    if (f.category) add('ci.category_id = ?', Number(f.category));
    if (f.campaign) add('ci.campaign_id = ?', f.campaign);
    if (f.product) add('ci.product ILIKE ?', `%${f.product}%`);
    if (f.platform) add('EXISTS (SELECT 1 FROM platform_publications p WHERE p.content_item_id=ci.id AND p.platform_code = ?)', f.platform);
    if (f.from) add('EXISTS (SELECT 1 FROM platform_publications p WHERE p.content_item_id=ci.id AND p.published_at >= ?)', f.from);
    if (f.to) add(`EXISTS (SELECT 1 FROM platform_publications p WHERE p.content_item_id=ci.id AND p.published_at < (?::date + 1))`, f.to);
    const rows = await q<any>(
      `SELECT ci.id, ci.code, ci.title, ci.product, ci.topic, ci.data_origin, cc.name AS category, cc.id AS category_id, cmp.name AS campaign,
              min(p.published_at) AS first_published_at,
              coalesce(array_agg(DISTINCT p.platform_code) FILTER (WHERE p.id IS NOT NULL), '{}') AS platforms,
              (array_agg(p.thumbnail_url ORDER BY p.published_at) FILTER (WHERE p.thumbnail_url IS NOT NULL))[1] AS thumbnail_url,
              sum(pv.value) AS total_views, count(pv.value) AS views_available_on, count(p.id) AS publication_count,
              sum(coalesce(pl.value,0) + coalesce(pr.value,0) + coalesce(pc.value,0) + coalesce(ps.value,0) + coalesce(psv.value,0)) AS engagement,
              (SELECT status FROM video_analysis_results v WHERE v.content_item_id=ci.id ORDER BY created_at DESC LIMIT 1) AS analysis_status,
              (SELECT json_build_object('id', j.id, 'code', j.code, 'status', j.status, 'has_final', j.final_drive_file_id IS NOT NULL OR j.final_path IS NOT NULL,
                        'has_thumb', j.thumbnail_path IS NOT NULL OR EXISTS (SELECT 1 FROM production_files tf WHERE tf.job_id=j.id AND tf.kind='take' AND tf.thumb_path IS NOT NULL),
                        'thumb_v', floor(extract(epoch from coalesce(j.thumbnail_updated_at, j.updated_at)))::bigint)
                 FROM production_jobs j WHERE j.content_item_id=ci.id ORDER BY j.created_at DESC LIMIT 1) AS studio
         FROM content_items ci
         LEFT JOIN content_categories cc ON cc.id=ci.category_id
         LEFT JOIN campaigns cmp ON cmp.id=ci.campaign_id
         LEFT JOIN platform_publications p ON p.content_item_id=ci.id
         LEFT JOIN publication_metrics pv ON pv.publication_id=p.id AND pv.metric_key='views' AND pv.availability='available'
         LEFT JOIN publication_metrics pl ON pl.publication_id=p.id AND pl.metric_key='likes' AND pl.availability='available'
         LEFT JOIN publication_metrics pr ON pr.publication_id=p.id AND pr.metric_key='reactions' AND pr.availability='available'
         LEFT JOIN publication_metrics pc ON pc.publication_id=p.id AND pc.metric_key='comments' AND pc.availability='available'
         LEFT JOIN publication_metrics ps ON ps.publication_id=p.id AND ps.metric_key='shares' AND ps.availability='available'
         LEFT JOIN publication_metrics psv ON psv.publication_id=p.id AND psv.metric_key='saves' AND psv.availability='available'
        WHERE ${where.join(' AND ')}
        GROUP BY ci.id, cc.name, cc.id, cmp.name
        ORDER BY min(p.published_at) DESC NULLS LAST, ci.created_at DESC
        LIMIT 500`, params);
    // Performance status: median within-platform percentile of avg view ratio + engagement rate
    const ds = await loadDataset(origin);
    const byPlat = new Map<string, typeof ds>();
    for (const r of ds) byPlat.set(r.platform, [...(byPlat.get(r.platform) ?? []), r]);
    const score = new Map<string, number[]>();
    for (const r of ds) {
      if (!r.content_item_id) continue;
      const peers = byPlat.get(r.platform)!;
      for (const m of ['avg_view_ratio', 'engagement_rate']) {
        const v = r.derived[m]; const vals = peers.map((p) => p.derived[m]).filter((x): x is number => x != null);
        if (v != null && vals.length >= 3) score.set(r.content_item_id, [...(score.get(r.content_item_id) ?? []), percentileRank(vals, v)]);
      }
    }
    for (const r of rows) {
      const s = score.get(r.id);
      const avg = s?.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
      r.performance_percentile = avg;
      r.performance_status = avg === null ? 'insufficient_data' : avg >= 0.75 ? 'top' : avg >= 0.4 ? 'typical' : avg >= 0.2 ? 'below' : 'needs_attention';
    }
    return rows;
  });

  app.post('/api/content', { preHandler: requirePermission('content.edit') }, async (req) => {
    const b = contentBody.parse(req.body);
    const r = await one<any>(
      `INSERT INTO content_items (title, description, category_id, campaign_id, product, topic, language, tags, business_objective, owner_id, data_origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live') RETURNING *`,
      [b.title, b.description ?? null, b.category_id ?? null, b.campaign_id ?? null, b.product ?? null, b.topic ?? null, b.language ?? null, b.tags ?? [], b.business_objective ?? null, b.owner_id ?? req.user_!.id]);
    await audit(req.user_!.id, 'content.create', 'content_item', r.id, { code: r.code });
    return r;
  });
  app.put('/api/content/:id', { preHandler: requirePermission('content.edit') }, async (req) => {
    const b = contentBody.parse(req.body);
    return one(`UPDATE content_items SET title=$2, description=$3, category_id=$4, campaign_id=$5, product=$6, topic=$7, language=$8, tags=$9, business_objective=$10, updated_at=now()
                WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.title, b.description ?? null, b.category_id ?? null, b.campaign_id ?? null, b.product ?? null, b.topic ?? null, b.language ?? null, b.tags ?? [], b.business_objective ?? null]);
  });

  app.get('/api/content/:id', { preHandler: requirePermission('content.view_all', 'content.view_assigned') }, async (req, reply) => {
    const { id } = req.params as any;
    const item = await one<any>(`SELECT ci.*, cc.name AS category, cmp.name AS campaign, cmp.code AS campaign_code FROM content_items ci LEFT JOIN content_categories cc ON cc.id=ci.category_id LEFT JOIN campaigns cmp ON cmp.id=ci.campaign_id WHERE ci.id=$1`, [id]);
    if (!item) return reply.code(404).send({ error: 'Not found' });
    if (!canSeeAll(req) && item.owner_id !== req.user_!.id) return reply.code(403).send({ error: 'Not assigned to you' });
    const publications = await q<any>(
      `SELECT p.*, sa.display_name AS account_name,
              coalesce(jsonb_object_agg(pm.metric_key, jsonb_build_object('value', pm.value, 'availability', pm.availability, 'collected_at', pm.collected_at)) FILTER (WHERE pm.metric_key IS NOT NULL), '{}') AS metrics
         FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id
         LEFT JOIN publication_metrics pm ON pm.publication_id=p.id
        WHERE p.content_item_id=$1 GROUP BY p.id, sa.display_name ORDER BY p.platform_code`, [id]);
    const assets = await q('SELECT id, asset_type, storage_uri, mime_type, duration_sec, width, height, size_bytes, created_at FROM content_assets WHERE content_item_id=$1 ORDER BY created_at DESC', [id]);
    const analysis = await one<any>(`SELECT * FROM video_analysis_results WHERE content_item_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    const segments = analysis ? await q('SELECT * FROM video_segments WHERE analysis_id=$1 ORDER BY start_sec', [analysis.id]) : [];
    const features = await q(`SELECT f.*, u.full_name AS corrected_by_name FROM content_features f LEFT JOIN users u ON u.id=f.corrected_by WHERE content_item_id=$1 ORDER BY feature_key`, [id]);
    const curves = await q(`SELECT DISTINCT ON (rc.publication_id) rc.publication_id, p.platform_code, rc.source_metric, rc.points, rc.duration_sec, rc.collected_at
                              FROM retention_curves rc JOIN platform_publications p ON p.id=rc.publication_id WHERE p.content_item_id=$1 ORDER BY rc.publication_id, rc.collected_at DESC`, [id]);
    return { item, publications, assets, analysis, segments, features, curves };
  });

  // Upload master video (multipart field "file")
  app.post('/api/content/:id/assets', { preHandler: requirePermission('content.edit') }, async (req, reply) => {
    const { id } = req.params as any;
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'No file' });
    const assetType = (file.fields?.asset_type?.value as string) ?? 'master_video';
    fs.mkdirSync(path.join(mediaDir, id), { recursive: true });
    const safe = file.filename.replace(/[^\w.\-]+/g, '_');
    const dest = path.join(mediaDir, id, `${Date.now()}_${safe}`);
    const hash = crypto.createHash('sha256');
    file.file.on('data', (c: Buffer) => hash.update(c));
    await pipeline(file.file, fs.createWriteStream(dest));
    const checksum = hash.digest('hex');
    const existing = await one<any>('SELECT * FROM content_assets WHERE content_item_id=$1 AND checksum_sha256=$2', [id, checksum]);
    if (existing) { fs.unlinkSync(dest); return { ...existing, duplicate: true }; }
    const asset = await one<any>(
      `INSERT INTO content_assets (content_item_id, asset_type, storage_uri, mime_type, size_bytes, checksum_sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, assetType, pathToFileURL(dest).toString(), file.mimetype, fs.statSync(dest).size, checksum]);
    await audit(req.user_!.id, 'asset.upload', 'content_item', id, { filename: safe, asset_type: assetType });
    if (assetType === 'master_video' || assetType === 'platform_video') await enqueue('analyze-video', { contentItemId: id, assetId: asset.id });
    return asset;
  });
  app.post('/api/content/:id/transcript', { preHandler: requirePermission('content.edit') }, async (req) => {
    const { id } = req.params as any;
    const { text } = z.object({ text: z.string().min(5) }).parse(req.body);
    return one(`INSERT INTO content_assets (content_item_id, asset_type, storage_uri, checksum_sha256) VALUES ($1,'transcript',$2,$3)
                ON CONFLICT (content_item_id, checksum_sha256) DO UPDATE SET created_at=now() RETURNING id`,
      [id, text, crypto.createHash('sha256').update(text).digest('hex')]);
  });
  app.post('/api/content/:id/analyze', { preHandler: requirePermission('analysis.run') }, async (req) => {
    const { id } = req.params as any;
    await enqueue('analyze-video', { contentItemId: id });
    await audit(req.user_!.id, 'analysis.run', 'content_item', id);
    return { queued: true };
  });
  // Human correction of an AI/heuristic feature
  app.put('/api/content/:id/features/:key', { preHandler: requirePermission('content.edit') }, async (req) => {
    const { id, key } = req.params as any;
    const b = z.object({ value_text: z.string().nullish(), value_num: z.number().nullish() }).parse(req.body);
    const before = await one('SELECT value_text, value_num, source FROM content_features WHERE content_item_id=$1 AND feature_key=$2', [id, key]);
    const r = await one(`INSERT INTO content_features (content_item_id, feature_key, value_text, value_num, source, confidence, corrected_by, updated_at)
                         VALUES ($1,$2,$3,$4,'human',1,$5,now())
                         ON CONFLICT (content_item_id, feature_key) DO UPDATE SET value_text=EXCLUDED.value_text, value_num=EXCLUDED.value_num, source='human', confidence=1, corrected_by=EXCLUDED.corrected_by, updated_at=now()
                         RETURNING *`, [id, key, b.value_text ?? null, b.value_num ?? null, req.user_!.id]);
    await audit(req.user_!.id, 'feature.correct', 'content_item', id, { key, before, after: b });
    return r;
  });

  // ---------- Publications
  app.get('/api/publications', { preHandler: authenticate }, async (req) => {
    const f = req.query as any;
    return q(`SELECT p.id, p.platform_code, p.platform_post_id, p.format, coalesce(p.title, left(p.caption, 120)) AS title, p.permalink, p.thumbnail_url, p.published_at,
                     p.content_item_id, ci.code AS content_code, (SELECT value FROM publication_metrics WHERE publication_id=p.id AND metric_key='views') AS views
                FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id LEFT JOIN content_items ci ON ci.id=p.content_item_id
               WHERE sa.data_origin=$1 AND ($2::boolean IS NOT TRUE OR p.content_item_id IS NULL) AND ($3::text IS NULL OR p.platform_code=$3)
               ORDER BY p.published_at DESC NULLS LAST LIMIT 1000`, [originOf(req), f.unlinked === 'true', f.platform ?? null]);
  });
  app.post('/api/publications/:id/link', { preHandler: requirePermission('content.edit') }, async (req) => {
    const { id } = req.params as any;
    const { content_item_id } = z.object({ content_item_id: z.string().uuid().nullable() }).parse(req.body);
    await q('UPDATE platform_publications SET content_item_id=$2 WHERE id=$1', [id, content_item_id]);
    await assignPublicationCode(id);
    await audit(req.user_!.id, 'publication.link', 'publication', id, { content_item_id });
    return { ok: true };
  });
  app.post('/api/publications/:id/create-content', { preHandler: requirePermission('content.edit') }, async (req) => {
    const { id } = req.params as any;
    const p = await one<any>('SELECT * FROM platform_publications WHERE id=$1', [id]);
    const title = (p.title ?? p.caption ?? 'Untitled').split('\n')[0].slice(0, 120);
    const ci = await one<any>(`INSERT INTO content_items (title, owner_id, data_origin) VALUES ($1,$2,'live') RETURNING *`, [title, req.user_!.id]);
    await q('UPDATE platform_publications SET content_item_id=$2 WHERE id=$1', [id, ci.id]);
    await assignPublicationCode(id);
    return ci;
  });
  app.get('/api/publications/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as any;
    const pub = await one<any>(`SELECT p.*, sa.display_name AS account_name, sa.data_origin, ci.code AS content_code, ci.title AS content_title
                                 FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id LEFT JOIN content_items ci ON ci.id=p.content_item_id WHERE p.id=$1`, [id]);
    if (!pub) return reply.code(404).send({ error: 'Not found' });
    const metrics = await q(`SELECT pm.*, md.description, md.platform_metric, md.unit FROM publication_metrics pm
                               LEFT JOIN metric_definitions md ON md.platform_code=$2 AND md.metric_key=pm.metric_key AND md.scope='publication'
                              WHERE pm.publication_id=$1 ORDER BY pm.metric_key`, [id, pub.platform_code]);
    const history = await q(`SELECT metric_key, value, availability, collected_at FROM metric_snapshots
                              WHERE publication_id=$1 AND period='lifetime' ORDER BY collected_at`, [id]);
    const daily = await q(`SELECT DISTINCT ON (metric_key, period_start) metric_key, period_start, value FROM metric_snapshots
                            WHERE publication_id=$1 AND period='day' ORDER BY metric_key, period_start, collected_at DESC`, [id]);
    const curve = await one(`SELECT * FROM retention_curves WHERE publication_id=$1 ORDER BY collected_at DESC LIMIT 1`, [id]);
    const audience = await q(`SELECT dimension, bucket, value, value_unit FROM audience_insights WHERE publication_id=$1 AND collected_date=(SELECT max(collected_date) FROM audience_insights WHERE publication_id=$1)`, [id]);
    return { publication: pub, metrics, history, daily, curve, audience };
  });
  app.get('/api/publications/:id/explain', { preHandler: requirePermission('insights.view') }, async (req, reply) => {
    const r = await explainPublication((req.params as any).id);
    return r ?? reply.code(404).send({ error: 'Not found' });
  });

  // ---------- Export (audited)
  app.get('/api/export/content.csv', { preHandler: requirePermission('data.export') }, async (req, reply) => {
    const rows = await q<any>(`SELECT ci.code, ci.title, p.platform_code, p.platform_post_id, p.published_at, pm.metric_key, pm.value, pm.availability
                                 FROM content_items ci JOIN platform_publications p ON p.content_item_id=ci.id JOIN publication_metrics pm ON pm.publication_id=p.id
                                WHERE ci.data_origin=$1 ORDER BY ci.code, p.platform_code, pm.metric_key`, [originOf(req)]);
    await audit(req.user_!.id, 'data.export', 'content', null, { rows: rows.length }, req.ip);
    const esc = (v: any) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = ['code,title,platform,post_id,published_at,metric,value,availability', ...rows.map((r) => [r.code, r.title, r.platform_code, r.platform_post_id, r.published_at?.toISOString?.() ?? r.published_at, r.metric_key, r.value, r.availability].map(esc).join(','))].join('\n');
    return reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="content_metrics.csv"').send(csv);
  });
}

const PREFIX: Record<string, string> = { instagram: 'INST', facebook: 'FB', youtube: 'YT', linkedin: 'LI' };
/** INST-001 style code, sequential per platform. */
export async function assignPublicationCode(pubId: string) {
  const p = await one<any>('SELECT platform_code, publication_code FROM platform_publications WHERE id=$1', [pubId]);
  if (!p || p.publication_code) return;
  const prefix = PREFIX[p.platform_code] ?? p.platform_code.toUpperCase();
  await q(`UPDATE platform_publications SET publication_code = $2 || '-' || lpad((
             SELECT coalesce(max(nullif(regexp_replace(publication_code, '^.*-', ''), '')::int), 0) + 1 FROM platform_publications WHERE platform_code=$3 AND publication_code IS NOT NULL)::text, 3, '0')
           WHERE id=$1`, [pubId, prefix, p.platform_code]);
}
