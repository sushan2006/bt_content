import { fileURLToPath } from 'node:url';
import { env } from '../config.js';
import { one, q, tx } from '../db/pool.js';
import { resolveSegments, TemplateSegment } from '../intelligence/segments.js';
import { request } from '../lib/http.js';

export async function analyzerHealth() {
  try { return await request<any>(`${env.ANALYZER_URL}/health`, { retries: 0 }); } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Queue-safe: creates the analysis row if needed, calls the Python analyzer, stores segments + features. */
export async function runVideoAnalysis(contentItemId: string, assetId?: string, analysisId?: string, transcriptText?: string) {
  const asset = assetId
    ? await one<any>('SELECT * FROM content_assets WHERE id=$1 AND content_item_id=$2', [assetId, contentItemId])
    : await one<any>(`SELECT * FROM content_assets WHERE content_item_id=$1 AND asset_type IN ('master_video','platform_video') ORDER BY (asset_type='master_video') DESC, created_at DESC LIMIT 1`, [contentItemId]);
  if (!asset) throw new Error('No video asset uploaded for this content item');
  const item = await one<any>('SELECT ci.*, cc.code AS category_code FROM content_items ci LEFT JOIN content_categories cc ON cc.id=ci.category_id WHERE ci.id=$1', [contentItemId]);
  const company = (await one<any>(`SELECT value FROM app_settings WHERE key='company'`))?.value ?? {};
  const id = analysisId ?? (await one<any>(`INSERT INTO video_analysis_results (content_item_id, asset_id, status) VALUES ($1,$2,'queued') RETURNING id`, [contentItemId, asset.id])).id;
  await q(`UPDATE video_analysis_results SET status='running', started_at=now() WHERE id=$1`, [id]);
  const transcriptAsset = transcriptText ?? (await one<any>(`SELECT storage_uri FROM content_assets WHERE content_item_id=$1 AND asset_type='transcript' ORDER BY created_at DESC LIMIT 1`, [contentItemId]))?.storage_uri;
  let subtitles: string | undefined = undefined;
  if (transcriptAsset?.startsWith('file://')) {
    const fs = await import('node:fs');
    subtitles = fs.readFileSync(fileURLToPath(transcriptAsset), 'utf8');
  } else if (transcriptAsset && !transcriptAsset.includes('://')) subtitles = transcriptAsset;

  try {
    if (!asset.storage_uri.startsWith('file://')) throw new Error(`Only local files can be analysed in Phase 1 (got ${asset.storage_uri})`);
    const path = fileURLToPath(asset.storage_uri);
    const res = await request<any>(`${env.ANALYZER_URL}/analyze`, {
      method: 'POST', retries: 0,
      body: { path, transcript_text: subtitles, language: item.language ?? undefined, product: item.product ?? undefined, company: company.name, company_keywords: company.intro_keywords ?? [] },
    });
    const tpl = (await one<any>(`SELECT segments FROM segment_templates WHERE is_default ORDER BY id LIMIT 1`))!.segments as TemplateSegment[];
    const segs = resolveSegments(tpl, res.duration);
    await tx(async (c) => {
      await c.query(
        `UPDATE video_analysis_results SET status='succeeded', analyzer_version=$2, duration_sec=$3, transcript=$4, scenes=$5, silences=$6, loudness=$7,
            frames=$8, summary=$9, finished_at=now(), error=NULL WHERE id=$1`,
        [id, res.analyzer_version, res.duration, JSON.stringify(res.transcript), JSON.stringify(res.scenes), JSON.stringify(res.silences),
         JSON.stringify(res.loudness), JSON.stringify(res.frames),
         JSON.stringify({ ...res.summary, statuses: { transcript: res.transcript_status, vision: res.vision_status, ocr: res.ocr_status } })]);
      await c.query('UPDATE content_assets SET duration_sec=$2, width=$3, height=$4 WHERE id=$1', [asset.id, res.duration, res.probe.width, res.probe.height]);
      await c.query('DELETE FROM video_segments WHERE analysis_id=$1', [id]);
      for (const s of segs) {
        const text = textBetween(res.transcript, s.start, s.end);
        const sceneChanges = res.scenes.filter((x: any) => x.start > s.start && x.start < s.end).length;
        const speech = speechSeconds(res.transcript, s.start, s.end);
        const silence = res.silences.reduce((acc: number, x: any) => acc + Math.max(0, Math.min(s.end, x.end ?? res.duration) - Math.max(s.start, x.start)), 0);
        const frames = res.frames.filter((f: any) => f.t >= s.start && f.t < s.end);
        await c.query(
          `INSERT INTO video_segments (analysis_id, content_item_id, segment_code, label, start_sec, end_sec, transcript_text, scene_changes, speech_ratio, silence_sec, observations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, contentItemId, s.code, s.label, s.start, s.end, text, sceneChanges,
           res.transcript_status.startsWith('ok') ? Math.min(1, speech / Math.max(0.01, s.end - s.start)) : null, silence,
           JSON.stringify({ on_screen_text: frames.map((f: any) => f.ocr).filter(Boolean), visuals: frames.map((f: any) => f.description).filter(Boolean), ctas: ctaWords(text) })]);
      }
      // Features: never overwrite a human correction
      for (const f of res.features) {
        await c.query(
          `INSERT INTO content_features (content_item_id, feature_key, value_text, value_num, source, confidence, analysis_id, evidence, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (content_item_id, feature_key) DO UPDATE SET value_text=EXCLUDED.value_text, value_num=EXCLUDED.value_num, source=EXCLUDED.source,
             confidence=EXCLUDED.confidence, analysis_id=EXCLUDED.analysis_id, evidence=EXCLUDED.evidence, updated_at=now()
           WHERE content_features.source <> 'human'`,
          [contentItemId, f.key, f.value, f.num, f.source, f.confidence, id, f.evidence ? JSON.stringify(f.evidence) : null]);
      }
      await c.query(
        `INSERT INTO content_features (content_item_id, feature_key, value_num, source, confidence, analysis_id) VALUES ($1,'duration_sec',$2,'platform',1,$3)
         ON CONFLICT (content_item_id, feature_key) DO UPDATE SET value_num=EXCLUDED.value_num, analysis_id=EXCLUDED.analysis_id, updated_at=now() WHERE content_features.source <> 'human'`,
        [contentItemId, res.duration, id]);
    });
    return { analysisId: id, status: 'succeeded' };
  } catch (e) {
    await q(`UPDATE video_analysis_results SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [id, (e as Error).message.slice(0, 1000)]);
    return { analysisId: id, status: 'failed', error: (e as Error).message };
  }
}

function textBetween(t: any[], a: number, b: number) {
  return t.filter((s) => s.end > a && s.start < b).map((s) => s.text).join(' ').trim();
}
function speechSeconds(t: any[], a: number, b: number) {
  return t.reduce((acc, s) => acc + Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)), 0);
}
function ctaWords(text: string) {
  return (text.match(/\b(visit|website|contact|enquir\w*|quote|call|order|buy|subscribe|follow|link)\b/gi) ?? []).map((x) => x.toLowerCase());
}
