/** Segment templates resolved against a real video duration, and retention measurements per segment. */

export interface TemplateSegment { code: string; label: string; start: number | string; end: number | string }
export interface Segment { code: string; label: string; start: number; end: number }
export interface CurvePoint { r: number; t: number | null; v: number }

/** "-15%" = 15% before end, "40%" = 40% of duration, number = seconds. */
function resolvePos(x: number | string, duration: number): number {
  if (typeof x === 'number') return x;
  const s = x.trim();
  if (s.endsWith('%')) {
    const pct = parseFloat(s) / 100;
    return pct < 0 ? duration * (1 + pct) : duration * pct;
  }
  const n = parseFloat(s);
  return n < 0 ? duration + n : n;
}

/**
 * Resolve template to concrete, non-overlapping segments for this duration.
 * - ending segment is anchored to the end and wins over earlier segments
 * - segments starting after the ending begins are dropped; the last kept one is stretched to meet the ending
 * - ending is at least min(3s, 25% of duration) long
 */
export function resolveSegments(template: TemplateSegment[], duration: number): Segment[] {
  if (!(duration > 0)) return [];
  const endTpl = template.find((t) => t.code === 'ending');
  const others = template.filter((t) => t.code !== 'ending');
  let endStart = endTpl ? resolvePos(endTpl.start, duration) : duration;
  const minEnd = Math.min(3, duration * 0.25);
  if (endTpl) endStart = Math.min(endStart, duration - minEnd);
  endStart = Math.max(0, endStart);
  const out: Segment[] = [];
  for (const t of others) {
    const s = Math.max(0, resolvePos(t.start, duration));
    let e = Math.min(resolvePos(t.end, duration), endStart);
    if (s >= endStart - 0.25) continue;
    if (e <= s) continue;
    if (out.length && e - s < 1.5) continue; // too short to measure: absorbed by the previous segment
    out.push({ code: t.code, label: t.label, start: round(s), end: round(e) });
  }
  if (out.length) out[out.length - 1].end = round(endStart);
  if (endTpl) out.push({ code: 'ending', label: endTpl.label, start: round(endStart), end: round(duration) });
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Linear interpolation of the retention value at time `sec`. */
export function retentionAt(points: CurvePoint[], sec: number, duration: number): number | null {
  if (!points.length || !(duration > 0)) return null;
  const r = Math.max(0, Math.min(1, sec / duration));
  const pts = points;
  if (r <= pts[0].r) return pts[0].v;
  if (r >= pts[pts.length - 1].r) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].r >= r) {
      const a = pts[i - 1], b = pts[i];
      return a.v + ((b.v - a.v) * (r - a.r)) / (b.r - a.r || 1);
    }
  }
  return null;
}

export interface SegmentRetention {
  code: string; label: string; start: number; end: number;
  start_retention: number | null; end_retention: number | null;
  drop: number | null;              // absolute share lost within the segment
  drop_per_sec: number | null;
  relative_drop: number | null;     // share of the audience present at segment start that left
  rewatch: boolean;                 // curve rises inside segment (rewatching / seeking back)
}

/**
 * Retention values are normalised to the curve's first point so that platforms reporting absolute ratios
 * (YouTube audienceWatchRatio can exceed 1) and percentages (Facebook) are comparable: 1.0 = everyone who started.
 */
export function normaliseCurve(points: CurvePoint[]): CurvePoint[] {
  if (!points.length) return [];
  const base = points[0].v || Math.max(...points.map((p) => p.v)) || 1;
  return points.map((p) => ({ ...p, v: p.v / base }));
}

export function segmentRetention(points: CurvePoint[], segments: Segment[], duration: number): SegmentRetention[] {
  const pts = normaliseCurve(points);
  return segments.map((s) => {
    const a = retentionAt(pts, s.start, duration), b = retentionAt(pts, s.end, duration);
    const inside = pts.filter((p) => p.r * duration >= s.start && p.r * duration <= s.end);
    let rewatch = false;
    for (let i = 1; i < inside.length; i++) if (inside[i].v - inside[i - 1].v > 0.02) rewatch = true;
    const drop = a !== null && b !== null ? a - b : null;
    return {
      ...s,
      start_retention: a, end_retention: b, drop,
      drop_per_sec: drop !== null && s.end > s.start ? drop / (s.end - s.start) : null,
      relative_drop: drop !== null && a ? drop / a : null,
      rewatch,
    };
  });
}

/** Steepest drop-off moments: windows where the per-second loss is far above the video's typical loss. */
export function dropOffPoints(points: CurvePoint[], duration: number, max = 3) {
  const pts = normaliseCurve(points);
  if (pts.length < 5 || !(duration > 0)) return [];
  const rates: { t: number; rate: number; from: number; to: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].r - pts[i - 1].r) * duration;
    if (dt <= 0) continue;
    rates.push({ t: ((pts[i - 1].r + pts[i].r) / 2) * duration, rate: (pts[i - 1].v - pts[i].v) / dt, from: pts[i - 1].v, to: pts[i].v });
  }
  const vals = rates.map((r) => r.rate);
  const m = vals.reduce((s, x) => s + x, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length);
  return rates
    .filter((r) => r.rate > m + 1.5 * sd && r.from - r.to > 0.01)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, max)
    .map((r) => ({ at_sec: Math.round(r.t * 10) / 10, loss: Math.round((r.from - r.to) * 1000) / 1000, per_sec: Math.round(r.rate * 1000) / 1000 }))
    .sort((a, b) => a.at_sec - b.at_sec);
}
