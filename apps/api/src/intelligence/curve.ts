/**
 * Retention-curve diagnostics: turns a curve into the handful of facts a content team uses.
 *  hook      share still watching after the opening (3 s, or 20% of very short videos)
 *  hold      how fast the rest of the video loses people (log-linear fit on the body: "loses X in 10 every 10 s")
 *  halfway   the second at which half the audience has gone
 *  ending    extra loss in the ending beyond the body's normal rate
 *  shape     named pattern (hook failure / slow bleed / mid-video collapse / ending drop / healthy)
 *  moments   steepest drop-offs, each matched to what was said / shown at that second
 */
import { CurvePoint, dropOffPoints, normaliseCurve, retentionAt } from './segments.js';
import { clock } from './plain.js';

export interface ContentEvents {
  transcript?: { start: number; end: number; text: string }[] | null;
  scenes?: { start: number; end: number }[] | null;
  silences?: { start: number; end: number | null }[] | null;
  frames?: { t: number; description?: string; ocr?: string }[] | null;
}

export type Shape = 'hook_failure' | 'slow_bleed' | 'mid_collapse' | 'ending_drop' | 'healthy';
export const SHAPE_PLAIN: Record<Shape, { name: string; meaning: string; fix: string }> = {
  hook_failure: { name: 'Lost at the start', meaning: 'Most viewers leave in the first seconds, before the message begins.', fix: 'Rework the first 3 seconds: show the product or the result immediately and say why it matters in one line.' },
  slow_bleed: { name: 'Steady leak', meaning: 'The opening works, but viewers keep leaving at a steady rate all the way through.', fix: 'Tighten the middle: cut pauses and repetition, change the shot more often, and get to the point faster.' },
  mid_collapse: { name: 'Drop in the middle', meaning: 'Viewers stay through the opening, then many leave at one specific moment.', fix: 'Look at what happens at that moment (a long explanation, a slow shot or a topic change) and shorten or replace it.' },
  ending_drop: { name: 'Leaves before the end', meaning: 'Viewers leave faster near the end, so fewer see the closing message and call to action.', fix: 'Move the call to action earlier and cut closing footage that signals the video is over.' },
  healthy: { name: 'Healthy', meaning: 'A normal start and a gradual decline with no sharp cliffs.', fix: 'Keep this structure; test small changes to the opening to push it further.' },
};

export interface CurveDiagnostics {
  duration: number;
  hook_at_sec: number;
  hook_kept: number;
  halfway_sec: number | null;
  loss_per_10s: number | null;     // share of remaining viewers lost every 10 seconds in the body
  completion: number;
  ending_excess_loss: number | null;
  shape: Shape;
  moments: { at_sec: number; at: string; lost: number; what: string }[];
  resolution_sec: number;
}

function eventAt(t: number, ev: ContentEvents): string {
  const parts: string[] = [];
  const line = ev.transcript?.find((s) => s.start <= t && s.end >= t) ?? ev.transcript?.find((s) => s.start <= t + 0.6 && s.end >= t - 0.6);
  if (line) parts.push(`while "${line.text.length > 90 ? line.text.slice(0, 87) + '…' : line.text}" was being said`);
  const sil = ev.silences?.find((s) => s.start <= t + 0.5 && (s.end ?? Infinity) >= t - 0.5);
  if (sil && !line) parts.push(`during ${(((sil.end ?? t + 1) - sil.start)).toFixed(1)} seconds with no voice`);
  const cut = ev.scenes?.find((s) => Math.abs(s.start - t) <= 1 && s.start > 0.2);
  if (cut) parts.push('right at a scene change');
  const fr = ev.frames?.filter((f) => f.description).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  if (fr && Math.abs(fr.t - t) <= 2) parts.push(`on screen: ${fr.description}`);
  if (!parts.length && t < 1) parts.push('in the very first second, before anything had been said');
  return parts.join('; ') || 'no content event recorded at this moment (upload the master video to see what was on screen)';
}

export function diagnoseCurve(points: CurvePoint[], duration: number, ev: ContentEvents = {}, cohort?: { hook_kept: number; loss_per_10s: number | null }): CurveDiagnostics | null {
  if (!points?.length || !(duration > 0)) return null;
  const pts = normaliseCurve(points);
  const at = (s: number) => retentionAt(pts, s, duration)!;
  const hookAt = Math.min(3, Math.max(1, duration * 0.2));
  const hook = at(hookAt);
  const endStart = Math.max(hookAt, duration * 0.85);
  // halfway
  let halfway: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v <= 0.5) {
      const a = pts[i - 1], b = pts[i];
      const r = a.r + ((a.v - 0.5) * (b.r - a.r)) / ((a.v - b.v) || 1);
      halfway = Math.round(r * duration * 10) / 10; break;
    }
  }
  // body decay: ln(v) ~ a + b t between hook and ending
  const body = pts.filter((p) => p.r * duration >= hookAt && p.r * duration <= endStart && p.v > 0.005);
  let b: number | null = null;
  if (body.length >= 3) {
    const xs = body.map((p) => p.r * duration), ys = body.map((p) => Math.log(p.v));
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
    b = sxy / sxx;
  }
  const lossPer10 = b === null ? null : Math.max(0, 1 - Math.exp(b * 10));
  const completion = at(duration);
  const vEndStart = at(endStart);
  const expectedEnd = b === null ? null : vEndStart * Math.exp(b * (duration - endStart));
  const endingExcess = expectedEnd === null ? null : Math.max(0, expectedEnd - completion);
  const drops = dropOffPoints(points, duration, 3);
  const moments = drops.map((d) => ({ at_sec: d.at_sec, at: clock(d.at_sec), lost: d.loss, what: eventAt(d.at_sec, ev) }));
  const midDrop = drops.find((d) => d.at_sec > duration * 0.2 && d.at_sec < duration * 0.8 && d.loss >= 0.08);

  const hookBad = 1 - hook >= 0.45 || (cohort && hook < cohort.hook_kept - 0.15);
  const bleed = lossPer10 !== null && (lossPer10 >= 0.35 || (cohort?.loss_per_10s != null && lossPer10 > cohort.loss_per_10s * 1.5));
  const shape: Shape = hookBad ? 'hook_failure' : midDrop ? 'mid_collapse' : (endingExcess ?? 0) >= 0.08 ? 'ending_drop' : bleed ? 'slow_bleed' : 'healthy';
  return {
    duration, hook_at_sec: Math.round(hookAt * 10) / 10, hook_kept: hook, halfway_sec: halfway, loss_per_10s: lossPer10, completion,
    ending_excess_loss: endingExcess, shape, moments, resolution_sec: Math.round((duration / Math.max(1, points.length - 1)) * 100) / 100,
  };
}

/** Hook-vs-hold diagnosis (read together, as creative analysts do). */
export function hookHoldDiagnosis(hookKept: number, lossPer10: number | null, cohortHook: number, cohortLoss: number | null) {
  const hookOk = hookKept >= cohortHook - 0.05;
  const holdOk = lossPer10 === null || cohortLoss === null ? true : lossPer10 <= cohortLoss * 1.15;
  if (!hookOk && !holdOk) return 'Both the opening and the rest of the video are weaker than usual. Fix the opening first: until more people get past it, changes later in the video will reach too few viewers to matter.';
  if (!hookOk) return 'The opening is the problem: people who get past it keep watching normally. Change the first 3 seconds, not the whole video.';
  if (!holdOk) return 'The opening works, but the video does not keep the promise it makes: people leave faster than usual after it. Fix the middle, not the hook.';
  return 'Both the opening and the rest of the video hold viewers at least as well as your usual content.';
}
