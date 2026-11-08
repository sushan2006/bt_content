/**
 * Intelligence engine v2.
 *
 * Layers
 *  1. Per-video diagnostics: curve shape, hook/hold, halfway point, drop moments matched to content, expected-vs-actual grade
 *  2. Drivers: multivariate model per outcome (controls for platform, length, publish date, paid) with cluster bootstrap,
 *     false-discovery-rate control across all findings, overlap warnings
 *  3. Portfolio findings: most common curve problem, where viewers leave, CTA reach, same video across platforms,
 *     business value funnel, trend over time, data gaps
 *  4. Plain-language story for every finding + an executive brief; statistics kept as "evidence"
 */
import crypto from 'node:crypto';
import { one, q } from '../db/pool.js';
import { loadDataset, PubRow } from './dataset.js';
import { mannWhitney, mean, median } from './stats.js';
import { benjaminiHochberg, driversModel, DriverEffect, expectedModel, gradeFromZ, shrinkGroups } from './models.js';
import { CurveDiagnostics, diagnoseCurve, hookHoldDiagnosis, Shape, SHAPE_PLAIN } from './curve.js';
import { per1000, actionPlain, SHAPE_VERB, shortValue, certaintyWords, clock, compareHeadline, compareSentence, featurePlain, fractionWords, inTen, OUTCOME_PLAIN, PLATFORM, ratioWords, videosNeeded } from './plain.js';

export const METRIC_LABELS: Record<string, string> = Object.fromEntries(Object.entries(OUTCOME_PLAIN).map(([k, v]) => [k, v.name]));

export interface Story { what_happened: string; why: string | null; what_to_do: string | null; how_sure: string; impact: string | null }
export interface Finding {
  insight_type: string;
  headline: string;
  story: Story;
  certainty: 'strong evidence' | 'good evidence' | 'early signal' | 'not enough data';
  evidence_level: 'direct_data' | 'statistical_association' | 'hypothesis' | 'needs_testing';
  sample_size: number;
  effect_size: number | null;
  p_value: number | null;
  metrics: Record<string, unknown>;     // technical evidence ("show the numbers")
  compared_items: unknown[];
  segments: unknown[] | null;
  cohort: Record<string, unknown>;
  rank_score: number;
  platform: string | null;
  rec_category: 'content' | 'platform' | 'publishing' | 'experiment' | 'data';
  experiment?: { variable: string; a: string; b: string; metric: string; per_arm: number } | null;
  narrative_source?: 'template';
}
const CONF: Record<Finding['certainty'], 'strong' | 'moderate' | 'preliminary' | 'insufficient'> = {
  'strong evidence': 'strong', 'good evidence': 'moderate', 'early signal': 'preliminary', 'not enough data': 'insufficient',
};
const W: Record<Finding['certainty'], number> = { 'strong evidence': 1, 'good evidence': 0.75, 'early signal': 0.45, 'not enough data': 0.1 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const short = (t: string) => (t.length > 60 ? t.slice(0, 57) + '…' : t);

async function settings() {
  const s = await one<any>(`SELECT value FROM app_settings WHERE key='analysis'`);
  return { min_sample_preliminary: 4, min_sample_moderate: 8, min_sample_strong: 15, alpha: 0.05, bootstrap_iterations: 400, ...(s?.value ?? {}) };
}

/* ================================================================== */
/* 1. Per-video diagnostics                                            */
/* ================================================================== */
export interface VideoDiag {
  publication_id: string; platform: string; title: string; content_item_id: string | null; content_code: string | null;
  curve: CurveDiagnostics | null; grade: string | null; grade_words: string | null; z: number | null;
  expected: Record<string, { actual: number; expected: number; z: number; peers: number }>;
}

export function videoDiagnostics(rows: PubRow[]): VideoDiag[] {
  const outcomes = ['retention_3s', 'avg_view_ratio', 'engagement_rate', 'shares_saves_rate'];
  const expMaps = Object.fromEntries(outcomes.map((o) => [o, expectedModel(rows.filter((r) => r.derived[o] != null)
    .map((r) => ({ id: r.publication_id, platform: r.platform, y: r.derived[o]!, logDuration: r.duration ? Math.log(r.duration) : null })))]));
  // cohort medians for curve diagnostics
  const firstPass = new Map<string, CurveDiagnostics | null>();
  for (const r of rows) firstPass.set(r.publication_id, r.curve && r.duration ? diagnoseCurve(r.curve, r.duration) : null);
  const cohort = new Map<string, { hook_kept: number; loss_per_10s: number | null }>();
  for (const p of new Set(rows.map((r) => r.platform))) {
    const ds = rows.filter((r) => r.platform === p).map((r) => firstPass.get(r.publication_id)).filter(Boolean) as CurveDiagnostics[];
    if (ds.length >= 3) cohort.set(p, { hook_kept: median(ds.map((d) => d.hook_kept)), loss_per_10s: median(ds.map((d) => d.loss_per_10s).filter((x): x is number => x != null)) });
  }
  return rows.map((r) => {
    const curve = r.curve && r.duration ? diagnoseCurve(r.curve, r.duration, r.events ?? {}, cohort.get(r.platform)) : null;
    const expected: VideoDiag['expected'] = {};
    for (const o of outcomes) {
      const e = expMaps[o].get(r.publication_id);
      if (e && r.derived[o] != null) expected[o] = { actual: r.derived[o]!, expected: e.expected, z: e.z, peers: e.peers };
    }
    const weights: Record<string, number> = { retention_3s: 1, avg_view_ratio: 1.5, engagement_rate: 1, shares_saves_rate: 0.75 };
    const zs = Object.entries(expected).map(([k, v]) => [Math.max(-3, Math.min(3, v.z)), weights[k]] as const);
    const z = zs.length ? zs.reduce((s, [v, w]) => s + v * w, 0) / zs.reduce((s, [, w]) => s + w, 0) : null;
    const g = z === null ? null : gradeFromZ(z);
    return { publication_id: r.publication_id, platform: r.platform, title: r.title, content_item_id: r.content_item_id, content_code: r.content_code,
      curve, grade: g?.grade ?? null, grade_words: g?.words ?? null, z, expected };
  });
}

/* ================================================================== */
/* 2. Drivers                                                          */
/* ================================================================== */
const DRIVER_SETS: Record<string, string[]> = {
  retention_3s: ['opening_style', 'product_shown_in_opening', 'opening_has_narration', 'editing_pace', 'edit_style'],
  avg_view_ratio: ['opening_style', 'product_shown_in_opening', 'editing_pace', 'category', 'edit_style'],
  engagement_rate: ['opening_style', 'category', 'editing_pace', 'cta_type', 'publish_slot', 'edit_style'],
  shares_saves_rate: ['category', 'opening_style', 'cta_type'],
};
const WHY: Record<string, string> = {
  retention_3s: 'Viewers decide in the first seconds whether a video is for them. Openings that show what the video is about straight away answer that question before people scroll on.',
  avg_view_ratio: 'When viewers understand early what they will get, more of them stay to see it.',
  engagement_rate: 'People react, share and save when the video gives them something specific to respond to or keep.',
  shares_saves_rate: 'People share and save videos that are useful to keep or pass on — practical, specific information more than general brand messages.',
};
const MECH_KEYS: [string, (a: number, b: number) => string][] = [
  ['subject_visible_by_sec', (a, b) => `the main subject was on screen after about ${a.toFixed(1)} seconds, against ${b.toFixed(1)} seconds in the others`],
  ['opening_scene_changes', (a, b) => `they changed shot ${a.toFixed(1)} times in the first 3 seconds, against ${b.toFixed(1)} times`],
];

function slotOf(iso: string, tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(iso)));
  return h < 6 ? 'night (midnight–6 am)' : h < 12 ? 'morning (6 am–noon)' : h < 17 ? 'afternoon (noon–5 pm)' : 'evening (5 pm–midnight)';
}

function driverFindings(rows: PubRow[], cfg: any, tz: string): { findings: Finding[]; models: Record<string, any> } {
  const start = Math.min(...rows.map((r) => (r.published_at ? Date.parse(r.published_at) : Infinity)));
  const candidates: { outcome: string; e: DriverEffect; model: any; best: { level: string; effect: number; low: number; high: number; pd: number; n: number }; ref: { level: string; n: number }; p: number }[] = [];
  const models: Record<string, any> = {};
  for (const [outcome, feats] of Object.entries(DRIVER_SETS)) {
    const drows = rows.filter((r) => r.content_item_id && r.derived[outcome] != null).map((r) => ({
      cluster: r.content_item_id!, platform: r.platform, y: r.derived[outcome]!,
      features: { ...Object.fromEntries(feats.map((f) => [f, r.features[f] == null ? null : String(r.features[f])])), publish_slot: r.published_at ? slotOf(r.published_at, tz) : null },
      logDuration: r.duration ? Math.log(r.duration) : null,
      daysSinceStart: r.published_at && Number.isFinite(start) ? (Date.parse(r.published_at) - start) / 864e5 : null, isPaid: r.is_paid,
    }));
    const m = driversModel(drows, feats, { bootstrap: cfg.bootstrap_iterations });
    if (!m) continue;
    models[outcome] = { n: m.n, videos: m.clusters, r2: m.r2, lambda: m.lambda, platforms: m.platforms, effects: m.effects };
    for (const f of feats) {
      const effs = m.effects.filter((e) => e.feature === f);
      if (!effs.length) continue;
      const ref = { level: effs[0].reference, n: effs[0].n_reference };
      const top = [...effs].sort((a, b) => b.effect_z - a.effect_z)[0], worst = [...effs].sort((a, b) => a.effect_z - b.effect_z)[0];
      // Case A: some level beats your usual approach.  Case B: your usual approach beats the alternatives.
      const useTop = top.effect_z > 0 && (top.effect_z >= -worst.effect_z || worst.effect_z >= 0);
      const e = useTop ? top : worst;
      if (Math.abs(e.effect_z) < 0.2) continue;
      const best = useTop
        ? { level: e.level, effect: e.effect_natural, low: e.low, high: e.high, pd: e.prob_direction, n: e.n_level }
        : { level: ref.level, effect: -e.effect_natural, low: -e.high, high: -e.low, pd: e.prob_direction, n: ref.n };
      const other = useTop ? ref : { level: e.level, n: e.n_level };
      candidates.push({ outcome, e, model: m, best, ref: other, p: Math.max(1 / cfg.bootstrap_iterations, 2 * (1 - e.prob_direction)) });
    }
  }
  const qv = benjaminiHochberg(candidates.map((c) => c.p));
  const views = median(rows.map((r) => r.metrics.views).filter((x): x is number => x != null)) || 0;
  const findings: Finding[] = [];
  candidates.forEach((c, i) => {
    if (qv[i] > 0.25 && c.e.prob_direction < 0.85) return; // noise
    const o = OUTCOME_PLAIN[c.outcome];
    const refRows = rows.filter((r) => r.content_item_id && r.derived[c.outcome] != null && String(c.e.feature === 'publish_slot' && r.published_at ? slotOf(r.published_at, tz) : r.features[c.e.feature]) === c.ref.level);
    const baseline = refRows.length ? median(refRows.map((r) => r.derived[c.outcome]!)) : median(rows.map((r) => r.derived[c.outcome]).filter((x): x is number => x != null));
    const improved = Math.max(0, baseline + c.best.effect);
    // count original videos, not posts (one video on three platforms is one piece of evidence)
    const levelOf = (r: PubRow) => String(c.e.feature === 'publish_slot' && r.published_at ? slotOf(r.published_at, tz) : r.features[c.e.feature]);
    const vids = (lv: string) => new Set(rows.filter((r) => r.content_item_id && r.derived[c.outcome] != null && levelOf(r) === lv).map((r) => r.content_item_id)).size;
    const nBest = vids(c.best.level), nRef = vids(c.ref.level), nTot = nBest + nRef;
    const cert = certaintyWords(nTot, qv[i] <= 0.05 ? Math.max(c.best.pd, 0.97) : c.best.pd, cfg.min_sample_preliminary);
    const bestTxt = featurePlain(c.e.feature, c.best.level), refTxt = featurePlain(c.e.feature, c.ref.level);
    if (compareSentence(c.outcome, bestTxt, improved, refTxt, baseline).match(/In videos that .*, (.*)\. In videos that .*, (.*)\.$/)?.slice(1).every((x, _, arr) => x === arr[0])) return; // indistinguishable in words
    const headline = compareHeadline(c.outcome, bestTxt, improved, baseline);
    // mechanism (only for openings)
    const mech: string[] = [];
    if (c.e.feature.startsWith('opening') || c.e.feature === 'product_shown_in_opening') {
      const a = rows.filter((r) => String(r.features[c.e.feature]) === c.best.level), b = rows.filter((r) => String(r.features[c.e.feature]) === c.ref.level);
      for (const [k, fmt] of MECH_KEYS) {
        const av = a.map((r) => Number(r.features[k])).filter(Number.isFinite), bv = b.map((r) => Number(r.features[k])).filter(Number.isFinite);
        if (av.length >= 2 && bv.length >= 2 && Math.abs(mean(av) - mean(bv)) >= 0.4) mech.push(fmt(mean(av), mean(bv)));
      }
    }
    const overlapOwner = featurePlain(c.e.feature, c.e.level);
    const overlapTxt = c.e.overlaps_with.length
      ? ` Note: most of the videos that ${overlapOwner} also ${c.e.overlaps_with.map((x) => { const [f, v] = x.split('='); return featurePlain(f, v); }).join(' and ')}, so these effects cannot be fully separated yet.` : '';
    const dur = median(rows.map((r) => r.duration).filter((x): x is number => x != null)) || 30;
    const impact = c.outcome === 'retention_3s' && views
      ? `On a typical video of yours (about ${n0(views)} views), that is roughly ${n0(views * Math.abs(c.best.effect))} more people getting past the opening — if the pattern holds.`
      : c.outcome === 'avg_view_ratio' && views
      ? `On a typical video of yours (about ${n0(views)} views, ${Math.round(dur)} seconds long), that adds up to about ${n0((views * Math.abs(c.best.effect) * dur) / 60)} more minutes of people watching your content — if the pattern holds.`
      : c.outcome === 'shares_saves_rate' ? `That is about ${n0(Math.abs(c.best.effect) * 10000)} more shares and saves for every 10,000 viewers — and shared videos reach new people — if the pattern holds.`
      : c.outcome === 'engagement_rate' ? `That is about ${n0(Math.abs(c.best.effect) * 1000)} more likes, comments, shares or saves per 1,000 viewers — if the pattern holds.` : null;
    const need = videosNeeded(c.e.effect_z);
    if (need === null || need > 40) return; // too small to matter in practice
    const per_arm = Math.max(5, need);
    findings.push({
      insight_type: 'driver', headline,
      story: {
        what_happened: `Comparing like with like (same platform, similar length, similar publishing period): ${compareSentence(c.outcome, bestTxt, improved, refTxt, baseline)} Based on ${nBest} and ${nRef} videos.`,
        why: `${WHY[c.outcome]}${mech.length ? ` In your videos, ${mech.join('; ')}.` : ''}${overlapTxt}`,
        what_to_do: `For the next videos: ${actionPlain(c.e.feature, c.best.level)}${c.outcome === 'retention_3s' ? ', keeping everything else the same so the effect can be measured' : ''}.`,
        how_sure: `${cert.sentence}${cert.label !== 'strong evidence' ? ` To confirm, publish about ${per_arm} videos each way.` : ''}`,
        impact,
      },
      certainty: cert.label, evidence_level: cert.label === 'strong evidence' || cert.label === 'good evidence' ? 'statistical_association' : 'needs_testing',
      sample_size: nTot, effect_size: Number(c.e.effect_z.toFixed(3)), p_value: Number(qv[i].toFixed(4)),
      metrics: { outcome: c.outcome, feature: c.e.feature, better: c.best.level, compared_with: c.ref.level, baseline, improved, effect: c.best.effect,
        interval_90: [c.best.low, c.best.high], probability_direction: c.best.pd, q_value: qv[i], model_r2: c.model.r2, model_videos: c.model.clusters,
        controls: ['platform', 'video length', 'publishing date', 'paid promotion'], overlaps: c.e.overlaps_with, method: 'ridge regression, outcome standardised within platform, cluster bootstrap over original videos, Benjamini–Hochberg FDR' },
      compared_items: rows.filter((r) => [c.best.level, c.ref.level].includes(String(r.features[c.e.feature])) && r.derived[c.outcome] != null)
        .map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, content_code: r.content_code, title: r.title, platform: r.platform,
          group: String(r.features[c.e.feature]), metric: c.outcome, value: r.derived[c.outcome], duration: r.duration })),
      segments: c.outcome.startsWith('retention_3s') ? rows.filter((r) => r.curve).map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, segment_code: 'opening', start_sec: 0, end_sec: 3 })) : null,
      cohort: { outcome: c.outcome, feature: c.e.feature, platforms: c.model.platforms },
      rank_score: Math.abs(c.e.effect_z) * W[cert.label] * (o.unit === 'share' ? 1.2 : 1),
      platform: null, rec_category: c.e.feature === 'publish_slot' ? 'publishing' : 'content',
      experiment: { variable: c.e.feature, a: c.best.level, b: c.ref.level, metric: c.outcome, per_arm },
    });
  });
  // One finding per piece of advice. When the same advice wins on several outcomes, lead with the most important
  // outcome (people staying > how much they watch > reactions > shares) and mention the others in the same finding.
  const PRIORITY: Record<string, number> = { retention_3s: 0, avg_view_ratio: 1, engagement_rate: 2, shares_saves_rate: 3 };
  findings.sort((a, b) => (PRIORITY[String(a.metrics.outcome)] - PRIORITY[String(b.metrics.outcome)]) || b.rank_score - a.rank_score);
  const byAdvice = new Map<string, Finding>(), perOutcome = new Map<string, number>(), kept: Finding[] = [];
  for (const f of findings) {
    const adviceKey = `${f.metrics.feature}|${f.metrics.better}`, o = String(f.metrics.outcome);
    const lead = byAdvice.get(adviceKey);
    if (lead) {
      lead.rank_score = Math.max(lead.rank_score, f.rank_score) + 0.1;
      ((lead.metrics.also ??= []) as unknown[]).push(f.metrics);
      continue;
    }
    if ((perOutcome.get(o) ?? 0) >= 3) continue;
    byAdvice.set(adviceKey, f); perOutcome.set(o, (perOutcome.get(o) ?? 0) + 1); kept.push(f);
  }
  const ALSO: Record<string, (a: number, b: number) => [string, string]> = {
    retention_3s: (a, b) => [`${inTen(a)} viewers staying past 3 seconds`, inTen(b)],
    avg_view_ratio: (a, b) => [`${fractionWords(a)} of the video watched`, fractionWords(b)],
    engagement_rate: (a, b) => [`${per1000(a)} likes, comments, shares and saves per 1,000 viewers`, per1000(b)],
    shares_saves_rate: (a, b) => [`${per1000(a)} shares and saves per 1,000 viewers`, per1000(b)],
  };
  for (const k of kept) {
    const parts = ((k.metrics.also ?? []) as any[]).map((m) => { const [x, y] = ALSO[m.outcome](m.improved, m.baseline); return x.startsWith(y + ' ') || x === y ? null : `${x} (against ${y})`; }).filter(Boolean);
    if (parts.length) k.story.what_happened += ` They also do better elsewhere: ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}.`;
  }
  kept.sort((a, b) => b.rank_score - a.rank_score);
  return { findings: kept, models };
}

/* ================================================================== */
/* 3. Portfolio findings                                               */
/* ================================================================== */
function curvePatterns(rows: PubRow[], diags: VideoDiag[]): Finding[] {
  const out: Finding[] = [];
  for (const p of new Set(diags.map((d) => d.platform))) {
    const ds = diags.filter((d) => d.platform === p && d.curve);
    if (ds.length < 3) continue;
    const counts = new Map<Shape, VideoDiag[]>();
    for (const d of ds) counts.set(d.curve!.shape, [...(counts.get(d.curve!.shape) ?? []), d]);
    const problems = [...counts].filter(([s]) => s !== 'healthy').sort((a, b) => b[1].length - a[1].length);
    const hookMed = median(ds.map((d) => d.curve!.hook_kept)), lossMed = median(ds.map((d) => d.curve!.loss_per_10s).filter((x): x is number => x != null));
    const halfMed = median(ds.map((d) => d.curve!.halfway_sec).filter((x): x is number => x != null));
    const healthy = counts.get('healthy')?.length ?? 0;
    if (problems.length) {
      const [shape, vids] = problems[0];
      const sp = SHAPE_PLAIN[shape];
      const example = (v: VideoDiag) => {
        const cd = v.curve!, m = cd.moments.filter((x) => x.at_sec > cd.hook_at_sec).sort((a, b) => b.lost - a.lost)[0];
        if (shape === 'hook_failure') return `"${short(v.title)}" (only ${inTen(cd.hook_kept)} stay past the opening)`;
        if (shape === 'mid_collapse' && m) return `"${short(v.title)}" (at ${m.at}, ${m.what})`;
        if (shape === 'slow_bleed' && cd.loss_per_10s != null) return `"${short(v.title)}" (loses ${inTen(cd.loss_per_10s)} of the remaining viewers every 10 seconds)`;
        if (shape === 'ending_drop') return `"${short(v.title)}" (only ${inTen(cd.completion)} reach the end)`;
        return `"${short(v.title)}"`;
      };
      const worst = [...vids].sort((a, b) => (shape === 'hook_failure' ? a.curve!.hook_kept - b.curve!.hook_kept : (b.curve!.moments[0]?.lost ?? 0) - (a.curve!.moments[0]?.lost ?? 0))).slice(0, 3);
      out.push({
        insight_type: 'curve_pattern',
        headline: `${PLATFORM[p]}: ${vids.length} of ${ds.length} videos follow the "${sp.name.toLowerCase()}" pattern`,
        story: {
          what_happened: `${sp.meaning} This is the most common problem in your ${PLATFORM[p]} videos (${vids.length} of ${ds.length}; ${healthy} ${healthy === 1 ? 'looks' : 'look'} healthy). On a typical ${PLATFORM[p]} video, ${inTen(hookMed)} viewers are still watching after the opening${Number.isFinite(halfMed) ? `, and half the audience has gone by ${clock(halfMed)}` : ''}. Clearest examples: ${worst.map(example).join('; ')}.`,
          why: `This is read directly from ${PLATFORM[p]}'s own second-by-second viewer data, not estimated.`,
          what_to_do: `In your ${PLATFORM[p]} videos: ${sp.fix.charAt(0).toLowerCase()}${sp.fix.slice(1)}`,
          how_sure: `Measured directly from the platform's viewer data for ${ds.length} videos. The pattern is a fact; the fix is the usual remedy for it and should be checked on the next videos.`,
          impact: null,
        },
        certainty: ds.length >= 8 ? 'good evidence' : 'early signal', evidence_level: 'direct_data', sample_size: ds.length, effect_size: null, p_value: null,
        metrics: { platform: p, shape, videos_with_shape: vids.length, videos: ds.length, shape_counts: Object.fromEntries([...counts].map(([s, v]) => [s, v.length])), median_hook_kept: hookMed, median_loss_per_10s: lossMed, median_halfway_sec: halfMed },
        compared_items: vids.map((v) => ({ publication_id: v.publication_id, content_item_id: v.content_item_id, content_code: v.content_code, title: v.title, platform: p, group: SHAPE_PLAIN[v.curve!.shape].name, metric: 'retention_3s', value: v.curve!.hook_kept })),
        segments: null, cohort: { platform: p }, rank_score: (vids.length / ds.length) * 1.5, platform: p, rec_category: 'content', experiment: null,
      });
    }
  }
  return out;
}

/**
 * Content risk: how fast do viewers leave during particular kinds of moment, compared with the rest of the same video?
 * Moments: long explanations (spoken lines of 14+ words), stretches with no voice, the seconds right after a scene cut.
 * Each video is compared with itself, so audience size and platform do not distort the result.
 */
const speedWords = (r: number) => (r < 1.2 ? 'a little faster' : r < 1.3 ? 'about a quarter faster' : r < 1.4 ? 'about a third faster' : r < 1.75 ? 'about one and a half times as fast' : r < 2.5 ? 'about twice as fast' : `about ${Math.round(r)} times as fast`);
const speedCompare = (r: number) => `${speedWords(r)} ${r < 1.4 ? 'than' : 'as'}`;
function contentRisk(rows: PubRow[], diags: VideoDiag[]): Finding[] {
  type Tag = 'long_explanation' | 'no_voice' | 'after_cut';
  const per: Record<Tag, { ratio: number; d: VideoDiag; example: string; at: number }[]> = { long_explanation: [], no_voice: [], after_cut: [] };
  for (const r of rows) {
    const d = diags.find((x) => x.publication_id === r.publication_id);
    const tr = r.events?.transcript;
    if (!d?.curve || !r.curve || !r.duration || !tr?.length) continue;
    const base = r.curve[0].v || 1, dur = r.duration, hook = d.curve.hook_at_sec;
    const tagged: Record<Tag | 'all', { rate: number; dt: number; t: number }[]> = { long_explanation: [], no_voice: [], after_cut: [], all: [] };
    for (let i = 1; i < r.curve.length; i++) {
      const t0 = r.curve[i - 1].r * dur, t1 = r.curve[i].r * dur, v0 = r.curve[i - 1].v / base, v1 = r.curve[i].v / base;
      if (t0 < hook || t1 > dur * 0.85 || v0 <= 0.01 || t1 <= t0) continue;
      const tm = (t0 + t1) / 2, rate = Math.max(0, (v0 - v1) / v0) / (t1 - t0), seg = { rate, dt: t1 - t0, t: tm };
      tagged.all.push(seg);
      const line = tr.find((x: any) => x.start <= tm && x.end >= tm);
      if (line && String(line.text).split(/\s+/).length >= 14) tagged.long_explanation.push(seg);
      if (!line || r.events?.silences?.some((x: any) => x.start <= tm && (x.end ?? dur) >= tm)) tagged.no_voice.push(seg);
      if (r.events?.scenes?.some((x: any) => x.start > 0.2 && tm >= x.start && tm - x.start <= 1.5)) tagged.after_cut.push(seg);
    }
    const avg = (xs: { rate: number; dt: number }[]) => xs.reduce((s2, x) => s2 + x.rate * x.dt, 0) / (xs.reduce((s2, x) => s2 + x.dt, 0) || 1);
    const overall = avg(tagged.all);
    if (!(overall > 0)) continue;
    for (const tag of ['long_explanation', 'no_voice', 'after_cut'] as Tag[]) {
      const segs = tagged[tag];
      if (segs.reduce((s2, x) => s2 + x.dt, 0) < 1) continue;
      const peak = [...segs].sort((a2, b2) => b2.rate - a2.rate)[0];
      const line = tr.find((x: any) => x.start <= peak.t && x.end >= peak.t);
      per[tag].push({ ratio: avg(segs) / overall, d, at: peak.t, example: line ? `"${String(line.text).slice(0, 80)}${String(line.text).length > 80 ? '…' : ''}"` : 'a stretch with no voice' });
    }
  }
  const LABEL: Record<Tag, { name: string; fix: string }> = {
    long_explanation: { name: 'long explanations (spoken sentences of 14 words or more)', fix: 'Break long explanations into short sentences, show the thing being explained on screen, and move detailed specifications to the caption or website.' },
    no_voice: { name: 'stretches with no voice', fix: 'Cover silent stretches with voice-over, on-screen text or music with a clear purpose, or cut them.' },
    after_cut: { name: 'the seconds right after a scene change', fix: 'Check the shots that follow these cuts: make transitions faster and keep the subject in frame and in focus from the first frame.' },
  };
  const summary = (Object.keys(per) as Tag[]).map((t) => ({ tag: t, videos: per[t].length, median_ratio: per[t].length ? median(per[t].map((x) => x.ratio)) : null, worse_in: per[t].filter((x) => x.ratio > 1).length }));
  const top = summary.filter((x) => x.videos >= 4 && ((x.median_ratio ?? 0) >= 1.3 || ((x.median_ratio ?? 0) >= 1.15 && x.worse_in / x.videos >= 0.75))).sort((a2, b2) => b2.median_ratio! - a2.median_ratio!)[0];
  if (!top) return [];
  const ex = [...per[top.tag]].sort((a2, b2) => b2.ratio - a2.ratio).filter((x, i, arr) => arr.findIndex((y) => y.d.content_item_id === x.d.content_item_id) === i).slice(0, 3);
  const cert = certaintyWords(new Set(per[top.tag].map((x) => x.d.content_item_id)).size, top.worse_in / top.videos >= 0.8 ? 0.95 : 0.88);
  return [{
    insight_type: 'content_risk',
    headline: `Viewers leave ${speedWords(top.median_ratio!)} during ${LABEL[top.tag].name.split(' (')[0]}`,
    story: {
      what_happened: `We matched each second of viewer data to what was being said and shown. During ${LABEL[top.tag].name}, viewers left ${speedCompare(top.median_ratio!)} in the rest of the same video. This happened in ${top.worse_in} of ${top.videos} videos. Clearest examples: ${ex.map((x) => `"${short(x.d.title)}" at ${clock(x.at)} — ${x.example}`).join('; ')}.`,
      why: 'Each video is compared with itself, so this is about the moment, not the audience or the platform. These are the points where viewers decided the video was no longer worth their time.',
      what_to_do: LABEL[top.tag].fix,
      how_sure: `${cert.sentence} Measured from the platforms' own viewer data matched to each video's transcript and scenes.`,
      impact: null,
    },
    certainty: cert.label, evidence_level: 'direct_data', sample_size: top.videos, effect_size: top.median_ratio, p_value: null,
    metrics: { by_moment_type: summary, method: 'per-video ratio of relative loss per second during tagged moments vs untagged body of the same video; median across videos' },
    compared_items: per[top.tag].map((x) => ({ publication_id: x.d.publication_id, content_item_id: x.d.content_item_id, content_code: x.d.content_code, title: x.d.title, platform: x.d.platform, group: clock(x.at), metric: 'times as fast', value: x.ratio })),
    segments: ex.map((x) => ({ publication_id: x.d.publication_id, content_item_id: x.d.content_item_id, segment_code: top.tag, start_sec: Math.max(0, x.at - 1), end_sec: x.at + 1 })),
    cohort: {}, rank_score: Math.min(1.6, (top.median_ratio! - 1) * W[cert.label] * 1.5), platform: null, rec_category: 'content', experiment: null,
  }];
}

function ctaReach(rows: PubRow[]): Finding[] {
  const out: Finding[] = [];
  for (const p of new Set(rows.map((r) => r.platform))) {
    const pr = rows.filter((r) => r.platform === p && r.derived.retention_at_cta != null && r.derived.retention_50pct != null);
    if (pr.length < 3) continue;
    const atCta = median(pr.map((r) => r.derived.retention_at_cta!)), atHalf = median(pr.map((r) => r.derived.retention_50pct!));
    if (atCta > 0.5) continue;
    out.push({
      insight_type: 'cta_reach', headline: `${PLATFORM[p]}: only ${inTen(atCta)} viewers are still there when the call to action starts`,
      story: {
        what_happened: `In a typical ${PLATFORM[p]} video, ${inTen(atCta)} of the people who start watching are still there for the final part, where the call to action usually is. At the halfway point it is still ${inTen(atHalf)} — ${ratioWords(atHalf, atCta, 'people')}.`,
        why: 'A call to action placed only at the end is seen by the smallest audience the video has.',
        what_to_do: 'Add a short call to action (spoken or on screen) just before the halfway point, and keep the one at the end.',
        how_sure: `Measured directly from ${pr.length} videos' viewer data.`,
        impact: `Moving it to the halfway point puts it in front of ${ratioWords(atHalf, atCta, 'viewers')}.`,
      },
      certainty: pr.length >= 8 ? 'good evidence' : 'early signal', evidence_level: 'direct_data', sample_size: pr.length, effect_size: null, p_value: null,
      metrics: { platform: p, median_at_cta: atCta, median_at_half: atHalf },
      compared_items: pr.map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, content_code: r.content_code, title: r.title, platform: p, metric: 'retention_at_cta', value: r.derived.retention_at_cta })),
      segments: null, cohort: { platform: p }, rank_score: (1 - atCta) * 0.8, platform: p, rec_category: 'experiment',
      experiment: { variable: 'cta_position', a: 'CTA before halfway + end', b: 'CTA at end only', metric: 'engagement_rate', per_arm: 5 },
    });
  }
  return out;
}

function crossPlatform(rows: PubRow[]): Finding[] {
  const out: Finding[] = [];
  const byContent = new Map<string, PubRow[]>();
  for (const r of rows) if (r.content_item_id) byContent.set(r.content_item_id, [...(byContent.get(r.content_item_id) ?? []), r]);
  for (const metric of ['avg_view_ratio', 'engagement_rate']) {
    const plats = [...new Set(rows.map((r) => r.platform))];
    let best: Finding | null = null;
    for (let i = 0; i < plats.length; i++) for (let j = i + 1; j < plats.length; j++) {
      const pairs = [...byContent.values()].map((v) => [v.find((x) => x.platform === plats[i]), v.find((x) => x.platform === plats[j])]).filter(([a, b]) => a?.derived[metric] != null && b?.derived[metric] != null) as [PubRow, PubRow][];
      if (pairs.length < 4) continue;
      const winsA = pairs.filter(([a, b]) => a.derived[metric]! > b.derived[metric]!).length;
      const [hi, lo, wins] = winsA >= pairs.length - winsA ? [plats[i], plats[j], winsA] : [plats[j], plats[i], pairs.length - winsA];
      if (wins / pairs.length < 0.7) continue;
      const side = (want: string) => pairs.map(([a, b]) => (a.platform === want ? a : b));
      const mHi = median(side(hi).map((r) => r.derived[metric]!)), mLo = median(side(lo).map((r) => r.derived[metric]!));
      const o = OUTCOME_PLAIN[metric];
      const f: Finding = {
        insight_type: 'platform_fit',
        headline: metric === 'avg_view_ratio' ? `The same video holds viewers better on ${PLATFORM[hi]} than on ${PLATFORM[lo]}` : `The same video gets more likes, comments, shares and saves on ${PLATFORM[hi]} than on ${PLATFORM[lo]}`,
        story: {
          what_happened: `${wins} of ${pairs.length} videos published on both did better on ${PLATFORM[hi]}. Typically, on ${PLATFORM[hi]} ${o.sentence(mHi)}; on ${PLATFORM[lo]} ${o.sentence(mLo)}.`,
          why: 'Because the video is identical, the difference comes from the platform: its audience, how it is shown in the feed, and how people browse there.',
          what_to_do: metric === 'avg_view_ratio' ? `Make a ${PLATFORM[lo]}-specific edit (shorter, faster opening) instead of posting the same file, and prioritise ${PLATFORM[hi]} for this kind of content.` : `Use ${PLATFORM[hi]} for content meant to start conversations, and on ${PLATFORM[lo]} add a direct question or prompt in the caption to invite responses.`,
          how_sure: certaintyWords(pairs.length, wins / pairs.length >= 0.85 ? 0.95 : 0.9).sentence,
          impact: null,
        },
        certainty: certaintyWords(pairs.length, wins / pairs.length >= 0.85 ? 0.95 : 0.9).label, evidence_level: 'statistical_association', sample_size: pairs.length, effect_size: wins / pairs.length, p_value: null,
        metrics: { metric, better: hi, worse: lo, wins, pairs: pairs.length, median_better: mHi, median_worse: mLo },
        compared_items: pairs.flatMap(([a, b]) => [a, b].map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, content_code: r.content_code, title: r.title, platform: r.platform, metric, value: r.derived[metric] }))),
        segments: null, cohort: { metric, platforms: [hi, lo] }, rank_score: (wins / pairs.length) * 0.9, platform: hi, rec_category: 'platform', experiment: null,
      };
      if (!best || f.rank_score > best.rank_score) best = f;
    }
    if (best) out.push(best);
  }
  return out;
}

function trend(rows: PubRow[], diags: VideoDiag[]): Finding[] {
  const pts = diags.filter((d) => d.z != null).map((d) => ({ d, t: Date.parse(rows.find((r) => r.publication_id === d.publication_id)?.published_at ?? '') })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  if (pts.length < 9) return [];
  const third = Math.floor(pts.length / 3), old = pts.slice(0, third).map((x) => x.d.z!), recent = pts.slice(-third).map((x) => x.d.z!);
  const { p } = mannWhitney(recent, old);
  const better = median(recent) > median(old);
  if (p > 0.3) return [];
  const certainty = certaintyWords(pts.length, 1 - p / 2);
  return [{
    insight_type: 'trend', headline: better ? 'Your recent videos perform better than your older ones' : 'Your recent videos perform worse than your older ones',
    story: {
      what_happened: `Comparing your most recent ${third} videos with your oldest ${third} (each against what we would expect for its platform and length), the recent ones are ${better ? 'stronger' : 'weaker'} overall.`,
      why: better ? 'Changes made recently seem to be working.' : 'Something changed recently — format, topics, timing or audience — and it is costing attention.',
      what_to_do: better ? 'Keep the recent approach and write down what changed so it becomes the standard.' : 'Compare a recent weak video with an older strong one, segment by segment, to see what changed.',
      how_sure: certainty.sentence, impact: null,
    },
    certainty: certainty.label, evidence_level: 'statistical_association', sample_size: pts.length, effect_size: median(recent) - median(old), p_value: p,
    metrics: { median_score_recent: median(recent), median_score_old: median(old) }, compared_items: [], segments: null, cohort: {},
    rank_score: 0.6, platform: null, rec_category: 'content', experiment: null,
  }];
}

function dataGaps(rows: PubRow[], scope: string, cfg: any): Finding[] {
  const out: Finding[] = [];
  const cov = {
    publications: rows.length, linked: rows.filter((r) => r.content_item_id).length, with_curve: rows.filter((r) => r.curve).length,
    analysed: rows.filter((r) => r.features.opening_style != null).length, with_events: rows.filter((r) => r.events?.transcript?.length).length,
  };
  const gap = (headline: string, what: string, todo: string): Finding => ({
    insight_type: 'data_coverage', headline, story: { what_happened: what, why: null, what_to_do: todo, how_sure: 'This is a statement about missing data.', impact: null },
    certainty: 'not enough data', evidence_level: 'direct_data', sample_size: 0, effect_size: null, p_value: null, metrics: { coverage: cov }, compared_items: [], segments: null, cohort: {},
    rank_score: 2, platform: null, rec_category: 'data', experiment: null,
  });
  if (!cov.publications) out.push(gap(`No ${scope} videos to analyse yet`, 'No published posts have been synchronised yet, so there is nothing to learn from.', 'Connect Instagram, Facebook and YouTube on the Integrations page and wait for the first sync.'));
  else {
    if (cov.linked < cov.publications) out.push(gap('Some posts are not linked to their original video', `${cov.publications - cov.linked} of ${cov.publications} posts are not linked, so they are left out of most comparisons.`, 'Link each post to its original video on the Publications page.'));
    if (cov.analysed < cfg.min_sample_preliminary) out.push(gap('Too few videos have been analysed for content patterns', `Only ${cov.analysed} published videos have had their content analysed (opening, pace, call to action). At least ${cfg.min_sample_preliminary} are needed.`, 'Upload the master video file for each published video.'));
    if (cov.with_curve && cov.with_events < Math.min(4, cov.with_curve)) out.push(gap('Drop-off moments cannot be matched to the video yet', `${cov.with_curve} posts have second-by-second viewer data, but only ${cov.with_events} have a transcript, so we cannot say what was being said when people left.`, 'Upload master videos (or subtitles) for the posts with viewer data.'));
  }
  return out;
}

/* ================================================================== */
/* 4. Executive brief                                                  */
/* ================================================================== */
function buildBrief(rows: PubRow[], diags: VideoDiag[], findings: Finding[], scope: string) {
  const graded = diags.filter((d) => d.grade);
  const real = findings.filter((f) => f.insight_type !== 'data_coverage').sort((a, b) => b.rank_score - a.rank_score);
  const pattern = real.find((f) => f.insight_type === 'curve_pattern');
  const topDriver = real.find((f) => f.insight_type === 'driver');
  const why = (d: VideoDiag) => {
    const e = Object.entries(d.expected).sort((a, b) => b[1].z - a[1].z);
    const [k, v] = (d.grade === 'A' || d.grade === 'B') ? e[0] : e.at(-1)!;
    return `${shortValue(k, v.actual)} (usually ${shortValue(k, v.expected).replace(/ of it$/, '')})`;
  };
  const wins = [...graded].sort((a, b) => b.z! - a.z!).slice(0, 3).filter((d) => d.z! > 0.35);
  const problems = [...graded].sort((a, b) => a.z! - b.z!).slice(0, 3).filter((d) => d.z! < -0.35);
  const views = rows.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
  const interactions = rows.reduce((s, r) => s + (r.metrics.likes ?? r.metrics.reactions ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0) + (r.metrics.saves ?? 0), 0);
  const watchMin = rows.reduce((s, r) => s + (r.metrics.total_watch_time_sec ?? 0), 0) / 60;
  const watched = median(rows.map((r) => r.derived.avg_view_ratio).filter((x): x is number => x != null));
  const pm: any = pattern?.metrics;
  const problemTxt = pm ? `${pm.videos_with_shape} of ${pm.videos} ${PLATFORM[pm.platform]} videos ${SHAPE_VERB[pm.shape]}` : null;
  const drv: any = topDriver?.metrics;
  const oppTxt = drv ? `${actionPlain(drv.feature, drv.better)}` : null;
  const headline = [problemTxt && cap(problemTxt) + '.', oppTxt && `Biggest opportunity: ${oppTxt}${topDriver!.certainty === 'early signal' ? ' (early signal — test it first)' : ''}.`].filter(Boolean).join(' ');
  return {
    scope,
    headline: headline || (real[0]?.headline ?? 'Not enough data for a summary yet.'),
    numbers: [
      { label: 'Videos analysed', value: n0(new Set(rows.map((r) => r.content_item_id ?? r.publication_id)).size), note: `${rows.length} posts across ${new Set(rows.map((r) => r.platform)).size} platforms` },
      { label: 'Views', value: n0(views), note: 'each platform counts views its own way' },
      { label: 'Likes, comments, shares and saves', value: n0(interactions), note: views ? `about ${Math.round((1000 * interactions) / views)} per 1,000 views` : '' },
      { label: 'Time spent watching', value: watchMin >= 600 ? `${n0(watchMin / 60)} hours` : `${n0(watchMin)} minutes`, note: Number.isFinite(watched) ? `a typical viewer watches ${fractionWords(watched)} of a video` : '' },
    ],
    wins: wins.map((d) => ({ publication_id: d.publication_id, title: d.title, platform: d.platform, grade: d.grade, text: `${cap(d.grade_words!)}: ${why(d)}.` })),
    problems: problems.map((d) => ({ publication_id: d.publication_id, title: d.title, platform: d.platform, grade: d.grade, text: `${cap(d.grade_words!)}${d.curve ? ` — ${SHAPE_PLAIN[d.curve.shape].name.toLowerCase()}` : ''}: ${why(d)}.` })),
    actions: mergeActions(real.filter((f) => f.story.what_to_do)).slice(0, 4),
    data_health: findings.filter((f) => f.insight_type === 'data_coverage').map((f) => f.headline),
  };
}

/** Same curve problem on several platforms → one action naming all of them. */
function mergeActions(fs: Finding[]) {
  const out: { title: string; action: string | null; impact: string | null; certainty: string }[] = [];
  const shapeSeen = new Map<string, { idx: number; platforms: string[]; titles: string[] }>();
  for (const f of fs) {
    const m: any = f.metrics;
    if (f.insight_type === 'curve_pattern') {
      const prev = shapeSeen.get(m.shape);
      if (prev) {
        prev.platforms.push(PLATFORM[m.platform]); prev.titles.push(f.headline);
        const fix = SHAPE_PLAIN[m.shape as Shape].fix;
        out[prev.idx] = { ...out[prev.idx], action: `In your ${prev.platforms.join(' and ')} videos: ${fix.charAt(0).toLowerCase()}${fix.slice(1)}`, title: prev.titles.join('; ') };
        continue;
      }
      shapeSeen.set(m.shape, { idx: out.length, platforms: [PLATFORM[m.platform]], titles: [f.headline] });
    }
    out.push({ title: f.headline, action: f.story.what_to_do, impact: f.story.impact, certainty: f.certainty });
  }
  return out;
}

/* ================================================================== */
/* Run                                                                 */
/* ================================================================== */
export async function runIntelligence(opts: { scope?: 'live' | 'demo'; userId?: string } = {}) {
  const scope = opts.scope ?? 'live';
  const cfg = await settings();
  const tz = (await one<any>(`SELECT value FROM app_settings WHERE key='company'`))?.value?.timezone ?? 'Asia/Kolkata';
  const rows = await loadDataset(scope);
  const runId = crypto.randomUUID();
  const diags = videoDiagnostics(rows);
  const { findings: drivers, models } = rows.length ? driverFindings(rows, cfg, tz) : { findings: [], models: {} };
  const findings: Finding[] = [
    ...drivers, ...curvePatterns(rows, diags), ...contentRisk(rows, diags), ...ctaReach(rows), ...crossPlatform(rows),
    ...trend(rows, diags), ...dataGaps(rows, scope, cfg),
  ].sort((a, b) => b.rank_score - a.rank_score);


  const origin = scope === 'demo' ? 'demo' : 'live';
  await q(`UPDATE ai_insights SET status='superseded' WHERE status='active' AND data_origin=$1`, [origin]);
  await q(`UPDATE ai_recommendations SET status='rejected', feedback=coalesce(feedback,'superseded by newer run') WHERE status='proposed' AND data_origin=$1`, [origin]);
  for (const f of findings) {
    const row = await one<{ id: string }>(
      `INSERT INTO ai_insights (run_id, insight_type, title, observation, explanation, evidence_level, confidence, sample_size, effect_size, p_value,
          metrics, compared_items, segments, recommended_action, next_experiment, cohort, narrative_source, data_origin, headline, story, certainty, rank_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
      [runId, f.insight_type, f.headline, f.story.what_happened, f.story.why, f.evidence_level, CONF[f.certainty], f.sample_size, f.effect_size, f.p_value,
       JSON.stringify(f.metrics), JSON.stringify(f.compared_items), f.segments ? JSON.stringify(f.segments) : null, f.story.what_to_do,
       f.experiment ? `Publish about ${f.experiment.per_arm} videos each way (${f.experiment.a.replace(/_/g, ' ')} vs ${f.experiment.b.replace(/_/g, ' ')}) and compare.` : null,
       JSON.stringify(f.cohort), f.narrative_source ?? 'template', origin, f.headline, JSON.stringify(f.story), f.certainty, f.rank_score]);
    if (f.story.what_to_do && (f.certainty !== 'not enough data' || f.rec_category === 'data')) {
      const rec = await one<{ id: string }>(
        `INSERT INTO ai_recommendations (run_id, category, title, body, platform_code, confidence, insight_ids, priority, data_origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [runId, f.rec_category, f.story.what_to_do.split('. ')[0].replace(/\.$/, '').slice(0, 160),
         [f.story.what_to_do, f.story.impact, `Why: ${f.headline}.`, f.story.how_sure].filter(Boolean).join('\n\n'),
         f.platform, CONF[f.certainty], [row!.id], f.rec_category === 'data' ? 1 : f.rank_score > 1 ? 1 : f.rank_score > 0.6 ? 2 : 3, origin]);
      if (f.experiment && (f.certainty === 'early signal' || f.certainty === 'good evidence')) {
        await q(`INSERT INTO analysis_experiments (recommendation_id, hypothesis, variable, variant_a, variant_b, primary_metric, min_sample_per_arm, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rec!.id, f.headline, f.experiment.variable, f.experiment.a, f.experiment.b, f.experiment.metric, f.experiment.per_arm, opts.userId ?? null]);
      }
    }
  }
  for (const d of diags) {
    await q(`INSERT INTO video_diagnostics (publication_id, run_id, grade, diagnostics, updated_at) VALUES ($1,$2,$3,$4, now())
             ON CONFLICT (publication_id) DO UPDATE SET run_id=EXCLUDED.run_id, grade=EXCLUDED.grade, diagnostics=EXCLUDED.diagnostics, updated_at=now()`,
      [d.publication_id, runId, d.grade, JSON.stringify(d)]);
  }
  const brief = buildBrief(rows, diags, findings, scope);
  await q(`INSERT INTO ai_briefs (run_id, data_origin, brief) VALUES ($1,$2,$3)`, [runId, origin, JSON.stringify(brief)]);
  const coverage = { publications: rows.length, with_retention_curve: rows.filter((r) => r.curve).length, with_video_analysis: rows.filter((r) => r.features.opening_style != null).length };
  return { runId, scope, insights: findings.length, coverage, models: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, { videos: v.videos, r2: Number(v.r2.toFixed(2)) }])) };
}

export { shrinkGroups };
