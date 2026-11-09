import { q } from '../db/pool.js';
import { CurvePoint, normaliseCurve, resolveSegments, retentionAt, segmentRetention, TemplateSegment, SegmentRetention } from './segments.js';

export interface PubRow {
  publication_id: string;
  content_item_id: string | null;
  content_code: string | null;
  title: string;
  platform: string;
  format: string | null;
  published_at: string | null;
  duration: number | null;
  category: string | null;
  data_origin: 'live' | 'demo';
  is_paid: boolean | null;
  features: Record<string, string | number | null>;
  metrics: Record<string, number | null>;
  availability: Record<string, string>;
  curve: CurvePoint[] | null;
  curve_resolution_sec: number | null;
  segments: SegmentRetention[] | null;
  derived: Record<string, number | null>;
  events: { transcript: any[] | null; scenes: any[] | null; silences: any[] | null; frames: any[] | null } | null;
  publication_code?: string | null;
}

export const durationBucket = (d: number | null) =>
  d === null ? null : d <= 15 ? '0-15s' : d <= 30 ? '15-30s' : d <= 60 ? '30-60s' : d <= 180 ? '1-3min' : '3min+';

export async function loadDataset(scope: 'live' | 'demo' | 'all' = 'live'): Promise<PubRow[]> {
  const originFilter = scope === 'all' ? '' : `AND sa.data_origin = '${scope === 'demo' ? 'demo' : 'live'}'`;
  const pubs = await q<any>(
    `SELECT p.id AS publication_id, p.content_item_id, ci.code AS content_code,
            coalesce(ci.title, p.title, left(p.caption, 80), p.platform_post_id) AS title,
            p.platform_code AS platform, p.format, p.publication_code, p.published_at, p.is_paid,
            coalesce(p.duration_sec, ca.duration_sec, var.duration_sec) AS duration,
            cc.code AS category, sa.data_origin
       FROM platform_publications p
       JOIN social_accounts sa ON sa.id = p.social_account_id
       LEFT JOIN content_items ci ON ci.id = p.content_item_id
       LEFT JOIN content_categories cc ON cc.id = ci.category_id
       LEFT JOIN LATERAL (SELECT duration_sec FROM content_assets WHERE content_item_id = ci.id AND asset_type='master_video' ORDER BY created_at DESC LIMIT 1) ca ON TRUE
       LEFT JOIN LATERAL (SELECT duration_sec FROM video_analysis_results WHERE content_item_id = ci.id AND status='succeeded' ORDER BY created_at DESC LIMIT 1) var ON TRUE
      WHERE p.publishing_status = 'published' ${originFilter}`);
  if (!pubs.length) return [];
  const ids = pubs.map((p) => p.publication_id);
  const metrics = await q<any>(`SELECT publication_id, metric_key, value, availability FROM publication_metrics WHERE publication_id = ANY($1)`, [ids]);
  const curves = await q<any>(
    `SELECT DISTINCT ON (publication_id) publication_id, points, duration_sec FROM retention_curves
      WHERE publication_id = ANY($1) ORDER BY publication_id, collected_at DESC`, [ids]);
  const contentIds = [...new Set(pubs.map((p) => p.content_item_id).filter(Boolean))];
  const feats = contentIds.length ? await q<any>(`SELECT content_item_id, feature_key, value_text, value_num FROM content_features WHERE content_item_id = ANY($1)`, [contentIds]) : [];
  const analyses = contentIds.length ? await q<any>(
    `SELECT DISTINCT ON (content_item_id) content_item_id, transcript, scenes, silences, frames FROM video_analysis_results
      WHERE content_item_id = ANY($1) AND status='succeeded' ORDER BY content_item_id, created_at DESC`, [contentIds]) : [];
  const tpl = (await q<any>(`SELECT segments FROM segment_templates WHERE is_default ORDER BY id LIMIT 1`))[0]?.segments as TemplateSegment[] | undefined;
  return buildRows({ pubs, metrics, curves, feats, analyses, tpl });
}

export interface RawDataset {
  pubs: any[]; metrics: { publication_id: string; metric_key: string; value: any; availability: string }[];
  curves: { publication_id: string; points: CurvePoint[]; duration_sec: any }[];
  feats: { content_item_id: string; feature_key: string; value_text: string | null; value_num: any }[];
  analyses: { content_item_id: string; transcript: any; scenes: any; silences: any; frames: any }[];
  tpl?: TemplateSegment[];
}

/** Pure part of loading: raw database rows → analysis rows with derived outcomes (unit-testable without a database). */
export function buildRows({ pubs, metrics, curves, feats, analyses, tpl }: RawDataset): PubRow[] {
  const evBy = new Map(analyses.map((a) => [a.content_item_id, { transcript: a.transcript, scenes: a.scenes, silences: a.silences, frames: a.frames }]));
  const byPub = new Map<string, PubRow>();
  for (const p of pubs) {
    byPub.set(p.publication_id, { ...p, duration: p.duration === null ? null : Number(p.duration), features: {}, metrics: {}, availability: {}, curve: null, curve_resolution_sec: null, segments: null, derived: {}, events: null });
  }
  for (const m of metrics) {
    const r = byPub.get(m.publication_id)!;
    r.metrics[m.metric_key] = m.availability === 'available' && m.value != null ? Number(m.value) : null;
    r.availability[m.metric_key] = m.availability;
  }
  for (const c of curves) {
    const r = byPub.get(c.publication_id)!;
    r.curve = c.points;
    if (!r.duration && c.duration_sec) r.duration = Number(c.duration_sec);
  }
  const featByContent = new Map<string, Record<string, any>>();
  for (const f of feats) {
    const o = featByContent.get(f.content_item_id) ?? {};
    o[f.feature_key] = f.value_text ?? f.value_num;
    featByContent.set(f.content_item_id, o);
  }
  for (const r of byPub.values()) {
    r.features = { ...(r.content_item_id ? featByContent.get(r.content_item_id) ?? {} : {}) };
    r.events = r.content_item_id ? evBy.get(r.content_item_id) ?? null : null;
    r.features.duration_bucket = durationBucket(r.duration);
    if (r.category) r.features.category = r.category;
    r.features.format = r.format;
    const m = r.metrics;
    const interactions = sumDefined([m.likes ?? m.reactions, m.comments, m.shares, m.saves]);
    const denom = m.reach ?? m.views ?? null;
    r.derived.engagement_rate = interactions !== null && denom ? interactions / denom : null;
    r.derived.avg_view_ratio = m.avg_watch_time_sec != null && r.duration ? Math.min(1.5, m.avg_watch_time_sec / r.duration) : (m.avg_view_percentage != null ? m.avg_view_percentage / 100 : null);
    r.derived.shares_saves_rate = denom && (m.shares != null || m.saves != null) ? ((m.shares ?? 0) + (m.saves ?? 0)) / denom : null;
    if (r.curve && r.duration) {
      const norm = normaliseCurve(r.curve);
      r.curve_resolution_sec = r.curve.length > 1 ? Math.round((r.duration / (r.curve.length - 1)) * 100) / 100 : null;
      r.derived.retention_3s = retentionAt(norm, 3, r.duration);
      r.derived.retention_8s = r.duration > 8 ? retentionAt(norm, 8, r.duration) : null;
      r.derived.retention_50pct = retentionAt(norm, r.duration / 2, r.duration);
      if (tpl) {
        const segs = resolveSegments(tpl, r.duration);
        r.segments = segmentRetention(r.curve, segs, r.duration);
        const end = r.segments.find((s) => s.code === 'ending');
        r.derived.retention_at_cta = end?.start_retention ?? null;
      }
    }
    // Instagram gives no curve, but it does give the skip rate: the share of views skipped in the first 3 seconds.
    if (r.derived.retention_3s == null && m.skip_rate != null) {
      const skip = m.skip_rate > 1 ? m.skip_rate / 100 : m.skip_rate; // the API reports a percentage
      if (skip >= 0 && skip <= 1) { r.derived.retention_3s = 1 - skip; r.derived.hook_from_skip_rate = 1; }
    }
    r.derived.age_days = r.published_at ? (Date.now() - Date.parse(r.published_at)) / 864e5 : null;
  }
  return [...byPub.values()];
}

function sumDefined(xs: (number | null | undefined)[]) {
  const d = xs.filter((x): x is number => typeof x === 'number');
  return d.length ? d.reduce((a, b) => a + b, 0) : null;
}
