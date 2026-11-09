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
import { fisherUpper, mannKendall, mean, median, theilSen } from './stats.js';
import { benjaminiHochberg, driversModel, DriverContrast, expectedModel, gradeFromZ, shrinkGroups } from './models.js';
import { CurveDiagnostics, diagnoseCurve, Shape, SHAPE_PLAIN } from './curve.js';
import { actionPlain, avoidPlain, SHAPE_VERB, certaintyFromTest, certaintyWords, clock, compareHeadline, compareSentence, featurePlain, inTen, OUTCOME_PLAIN, PLATFORM, ratioWords, twoValues, videosNeeded } from './plain.js';

export const METRIC_LABELS: Record<string, string> = Object.fromEntries(Object.entries(OUTCOME_PLAIN).map(([k, v]) => [k, v.name]));

export interface Story { what_happened: string; why: string | null; what_to_do: string | null; how_sure: string; impact: string | null }
/**
 * The one-line lesson a finding gives for the next video (shown on New video and put into the edit prompt).
 * for_claude: false when it is not an editing decision (topic choice, publishing time, the style already picked).
 */
export interface Learning { kind: 'do' | 'avoid'; text: string; why: string; topic: string; for_claude: boolean; platforms?: string[]; style?: string }
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
  return { ...DEFAULT_ANALYSIS, ...(s?.value ?? {}) };
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

const NOT_EDITING = new Set(['category', 'publish_slot', 'edit_style']);
/** "7 in 10 viewers stay past the first 3 seconds, against 5 in 10 in your other videos" */
function whyLine(outcome: string, a: number, b: number, other = 'in your other videos') {
  const v = twoValues(outcome, a, b);
  switch (outcome) {
    case 'retention_3s': return `${v.a} viewers stay past the first 3 seconds, against ${v.b} ${other}`;
    case 'avg_view_ratio': return `people watch ${v.a} of the video, against ${v.b} ${other}`;
    case 'engagement_rate': return `${v.a} in 1,000 viewers like, comment, share or save, against ${v.b} ${other}`;
    case 'shares_saves_rate': return `${v.a} in 1,000 viewers share or save it, against ${v.b} ${other}`;
    default: return '';
  }
}

function driverFindings(rows: PubRow[], cfg: any, tz: string): { findings: Finding[]; models: Record<string, any> } {
  const start = Math.min(...rows.map((r) => (r.published_at ? Date.parse(r.published_at) : Infinity)));
  const levelOf = (r: PubRow, f: string) => (f === 'publish_slot' ? (r.published_at ? slotOf(r.published_at, tz) : null) : r.features[f] == null ? null : String(r.features[f]));
  const candidates: { outcome: string; c: DriverContrast; model: any; dir: 'do' | 'avoid'; p: number }[] = [];
  const models: Record<string, any> = {};
  for (const [outcome, feats] of Object.entries(DRIVER_SETS)) {
    const drows = rows.filter((r) => r.content_item_id && r.derived[outcome] != null).map((r) => ({
      cluster: r.content_item_id!, platform: r.platform, y: r.derived[outcome]!,
      features: Object.fromEntries(feats.map((f) => [f, levelOf(r, f)])),
      logDuration: r.duration ? Math.log(r.duration) : null,
      daysSinceStart: r.published_at && Number.isFinite(start) ? (Date.parse(r.published_at) - start) / 864e5 : null, isPaid: r.is_paid,
    }));
    const m = driversModel(drows, feats, { bootstrap: cfg.bootstrap_iterations });
    if (!m) continue;
    models[outcome] = { n: m.n, videos: m.clusters, r2: m.r2, lambda: m.lambda, platforms: m.platforms, effects: m.effects, contrasts: m.contrasts };
    for (const f of feats) {
      const cs = m.contrasts.filter((c) => c.feature === f);
      if (cs.length < 2) continue;
      const best = [...cs].sort((x, y) => y.effect_z - x.effect_z)[0], worst = [...cs].sort((x, y) => x.effect_z - y.effect_z)[0];
      const p = (c: DriverContrast) => c.p_perm;
      if (best.effect_z >= 0.2) candidates.push({ outcome, c: best, model: m, dir: 'do', p: p(best) });
      // with two levels "avoid B" is just "do A" said the other way round, so avoid-findings only come from features with 3+ levels
      if (cs.length >= 3 && worst !== best && worst.effect_z <= -0.2) candidates.push({ outcome, c: worst, model: m, dir: 'avoid', p: p(worst) });
    }
  }
  const qv = benjaminiHochberg(candidates.map((c) => c.p));
  const views = median(rows.map((r) => r.metrics.views).filter((x): x is number => x != null)) || 0;
  const dur = median(rows.map((r) => r.duration).filter((x): x is number => x != null)) || 30;
  const findings: Finding[] = [];
  candidates.forEach(({ outcome, c, model, dir }, i) => {
    if (qv[i] > 0.15) return; // could easily be chance once all the patterns checked are taken into account
    const o = OUTCOME_PLAIN[outcome], f = c.feature, level = c.level;
    const known = rows.filter((r) => r.content_item_id && r.derived[outcome] != null && levelOf(r, f) != null);
    const lvRows = known.filter((r) => levelOf(r, f) === level), restRows = known.filter((r) => levelOf(r, f) !== level);
    if (!lvRows.length || !restRows.length) return;
    const baseline = median(restRows.map((r) => r.derived[outcome]!));
    const value = Math.max(0, baseline + c.effect_natural);       // model-adjusted: same platform, length and period
    const v = twoValues(outcome, value, baseline);
    if (v.same || (o.unit !== 'share' && ratioWords(value, baseline).startsWith('about the same'))) return; // too small to show honestly
    // count original videos, not posts (one video on three platforms is one piece of evidence)
    const nLv = new Set(lvRows.map((r) => r.content_item_id)).size, nRest = new Set(restRows.map((r) => r.content_item_id)).size;
    if (nLv < 2) return;
    // certainty from the corrected permutation test; the smaller group limits what can be claimed
    const cert = certaintyFromTest(nLv + nRest, qv[i], Math.min(nLv, nRest), cfg.min_sample_preliminary);
    if (!cert) return;
    const txt = featurePlain(f, level);
    const headline = compareHeadline(outcome, txt, value, baseline, 'your other videos');
    const mech: string[] = [];
    if (f.startsWith('opening') || f === 'product_shown_in_opening') {
      for (const [k, fmt] of MECH_KEYS) {
        const av = lvRows.map((r) => Number(r.features[k])).filter(Number.isFinite), bv = restRows.map((r) => Number(r.features[k])).filter(Number.isFinite);
        if (av.length >= 2 && bv.length >= 2 && Math.abs(mean(av) - mean(bv)) >= 0.4) mech.push(fmt(mean(av), mean(bv)));
      }
    }
    const overlapTxt = c.overlaps_with.length
      ? ` Note: most of the videos that ${txt} also ${c.overlaps_with.map((x) => { const [ff, vv] = x.split('='); return featurePlain(ff, vv); }).join(' and ')}, so these effects cannot be fully separated yet.` : '';
    const more = dir === 'do' ? 'more' : 'fewer', eff = Math.abs(c.effect_natural);
    const impact = outcome === 'retention_3s' && views
      ? `On a typical video of yours (about ${n0(views)} views), that is roughly ${n0(views * eff)} ${more} people getting past the opening — if the pattern holds.`
      : outcome === 'avg_view_ratio' && views
      ? `On a typical video of yours (about ${n0(views)} views, ${Math.round(dur)} seconds long), that is about ${n0((views * eff * dur) / 60)} ${more} minutes of people watching — if the pattern holds.`
      : outcome === 'shares_saves_rate' ? `That is about ${n0(eff * 10000)} ${more} shares and saves for every 10,000 viewers${dir === 'do' ? ' — and shared videos reach new people' : ''} — if the pattern holds.`
      : outcome === 'engagement_rate' ? `That is about ${n0(eff * 1000)} ${more} likes, comments, shares or saves per 1,000 viewers — if the pattern holds.` : null;
    const need = videosNeeded(c.effect_z);
    // too small to matter: under 0.3 standard deviations. (A medium effect that needs many videos to *prove* is still shown, with that caveat.)
    if (need === null || Math.abs(c.effect_z) < 0.3) return;
    const per_arm = Math.max(5, need);
    const test = cert.label === 'strong evidence' ? ''
      : per_arm <= 12 ? ` To confirm, make the next ${per_arm} videos this way and compare them with the rest.`
      : ` The difference is modest, so proving it takes many videos (about ${per_arm} each way): act on it, but expect a gradual change rather than a jump.`;
    const action = dir === 'do' ? actionPlain(f, level) : avoidPlain(f, level);
    const learning: Learning = { kind: dir, text: cap(action), why: whyLine(outcome, value, baseline), topic: `${f}=${level}`, for_claude: !NOT_EDITING.has(f), ...(f === 'edit_style' ? { style: level } : {}) };
    findings.push({
      insight_type: 'driver', headline,
      story: {
        what_happened: `Comparing like with like (same platform, similar length, similar publishing period): ${compareSentence(outcome, txt, value, null, baseline)} Based on ${nLv} video${nLv === 1 ? '' : 's'} that do this and ${nRest} that do not.`,
        why: `${WHY[outcome]}${mech.length ? ` In your videos, ${mech.join('; ')}.` : ''}${overlapTxt}`,
        what_to_do: `For the next videos: ${action}${outcome === 'retention_3s' && dir === 'do' && !NOT_EDITING.has(f) ? ', keeping everything else the same so the effect can be measured' : ''}.`,
        how_sure: `${cert.sentence}${test}`,
        impact,
      },
      certainty: cert.label, evidence_level: cert.label === 'strong evidence' || cert.label === 'good evidence' ? 'statistical_association' : 'needs_testing',
      sample_size: nLv + nRest, effect_size: Number(c.effect_z.toFixed(3)), p_value: Number(qv[i].toFixed(4)),
      metrics: { outcome, feature: f, direction: dir, level, better: dir === 'do' ? level : null, worse: dir === 'avoid' ? level : null, compared_with: 'the rest',
        baseline, improved: value, effect: c.effect_natural, interval_90: [c.low, c.high], probability_direction: c.prob_direction, p_permutation: c.p_perm, q_value: qv[i],
        model_r2: model.r2, model_videos: model.clusters, videos_with: nLv, videos_without: nRest,
        controls: ['platform', 'video length', 'publishing date', 'paid promotion'], overlaps: c.overlaps_with, learning,
        method: 'ridge regression, outcome standardised within platform, each tag contrasted with the count-weighted rest; p-value by permutation of the tag across whole videos, Benjamini–Hochberg FDR; interval by cluster bootstrap' },
      compared_items: known.map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, content_code: r.content_code, title: r.title, platform: r.platform,
        group: levelOf(r, f), metric: outcome, value: r.derived[outcome], duration: r.duration })),
      segments: outcome === 'retention_3s' ? rows.filter((r) => r.curve).map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, segment_code: 'opening', start_sec: 0, end_sec: 3 })) : null,
      cohort: { outcome, feature: f, platforms: model.platforms },
      rank_score: Math.abs(c.effect_z) * W[cert.label] * (o.unit === 'share' ? 1.2 : 1) * (dir === 'avoid' ? 0.9 : 1),
      platform: null, rec_category: f === 'publish_slot' ? 'publishing' : 'content',
      experiment: dir === 'do' ? { variable: f, a: level, b: 'the rest', metric: outcome, per_arm } : null,
    });
  });
  // One finding per piece of advice. When the same advice wins on several outcomes, lead with the most important
  // outcome (people staying > how much they watch > reactions > shares) and mention the others in the same finding.
  const PRIORITY: Record<string, number> = { retention_3s: 0, avg_view_ratio: 1, engagement_rate: 2, shares_saves_rate: 3 };
  findings.sort((a, b) => (PRIORITY[String(a.metrics.outcome)] - PRIORITY[String(b.metrics.outcome)]) || b.rank_score - a.rank_score);
  const byAdvice = new Map<string, Finding>(), perOutcome = new Map<string, number>(), kept: Finding[] = [];
  for (const f of findings) {
    const adviceKey = `${f.metrics.feature}|${f.metrics.direction}|${f.metrics.level}`, o = String(f.metrics.outcome);
    const lead = byAdvice.get(adviceKey);
    if (lead) {
      lead.rank_score = Math.max(lead.rank_score, f.rank_score) + 0.1;
      ((lead.metrics.also ??= []) as unknown[]).push(f.metrics);
      continue;
    }
    if ((perOutcome.get(o) ?? 0) >= 3) continue;
    byAdvice.set(adviceKey, f); perOutcome.set(o, (perOutcome.get(o) ?? 0) + 1); kept.push(f);
  }
  // the same tag cannot be both advice and warning: keep the stronger one
  const final = kept.filter((f) => {
    const twin = kept.find((g) => g !== f && g.metrics.feature === f.metrics.feature && g.metrics.level === f.metrics.level && g.metrics.direction !== f.metrics.direction);
    return !twin || f.rank_score >= twin.rank_score;
  });
  const ALSO: Record<string, (v: { a: string; b: string }) => string> = {
    retention_3s: (v) => `${v.a} viewers staying past 3 seconds (against ${v.b})`,
    avg_view_ratio: (v) => `${v.a} of the video watched (against ${v.b})`,
    engagement_rate: (v) => `${v.a} likes, comments, shares and saves per 1,000 viewers (against ${v.b})`,
    shares_saves_rate: (v) => `${v.a} shares and saves per 1,000 viewers (against ${v.b})`,
  };
  for (const k of final) {
    const parts = ((k.metrics.also ?? []) as any[]).map((m) => { const v = twoValues(m.outcome, m.improved, m.baseline); return v.same ? null : ALSO[m.outcome](v); }).filter(Boolean) as string[];
    if (parts.length) k.story.what_happened += ` They also do ${k.metrics.direction === 'do' ? 'better' : 'worse'} elsewhere: ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}.`;
  }
  final.sort((a, b) => b.rank_score - a.rank_score);
  return { findings: final, models };
}

/* ================================================================== */
/* 3. Portfolio findings                                               */
/* ================================================================== */
/** The same fixes, written for a video that has not been made yet (the finding's own fix refers to a past video). */
const SHAPE_LESSON: Record<Shape, string> = {
  hook_failure: 'Make the first 3 seconds count: show the product or the result straight away and say in one line why it matters',
  mid_collapse: 'Keep the middle tight: no long explanations, slow shots or sudden topic changes — that is where many of your viewers leave',
  slow_bleed: 'Keep the pace up after the opening: cut pauses and repetition and change the shot often',
  ending_drop: 'Put the call to action before the last part, and cut closing footage that signals the video is over',
  healthy: 'Keep the structure that works',
};
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
          what_to_do: `In your ${PLATFORM[p]} videos, ${sp.fix.charAt(0).toLowerCase()}${sp.fix.slice(1)}`,
          how_sure: `Measured directly from the platform's viewer data for ${ds.length} videos. The pattern is a fact; the fix is the usual remedy for it and should be checked on the next videos.`,
          impact: null,
        },
        certainty: ds.length >= 8 ? 'good evidence' : 'early signal', evidence_level: 'direct_data', sample_size: ds.length, effect_size: null, p_value: null,
        metrics: { platform: p, shape, videos_with_shape: vids.length, videos: ds.length, shape_counts: Object.fromEntries([...counts].map(([s, v]) => [s, v.length])), median_hook_kept: hookMed, median_loss_per_10s: lossMed, median_halfway_sec: halfMed,
          learning: { kind: 'do', text: SHAPE_LESSON[shape], why: `${vids.length} of ${ds.length} ${PLATFORM[p]} videos ${SHAPE_VERB[shape]}`, topic: `shape:${shape}`, for_claude: true, platforms: [p] } satisfies Learning },
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
  // one entry per original video (a video posted on several platforms counts once: the median of its posts)
  for (const t of Object.keys(per) as Tag[]) {
    const by = new Map<string, typeof per[Tag]>();
    for (const x of per[t]) { const k = x.d.content_item_id ?? x.d.publication_id; by.set(k, [...(by.get(k) ?? []), x]); }
    per[t] = [...by.values()].map((xs) => ({ ...[...xs].sort((a2, b2) => b2.ratio - a2.ratio)[0], ratio: median(xs.map((x) => x.ratio)) }));
  }
  const summary = (Object.keys(per) as Tag[]).map((t) => ({ tag: t, videos: per[t].length, median_ratio: per[t].length ? median(per[t].map((x) => x.ratio)) : null, worse_in: per[t].filter((x) => x.ratio > 1).length }));
  const top = summary.filter((x) => x.videos >= 4 && ((x.median_ratio ?? 0) >= 1.3 || ((x.median_ratio ?? 0) >= 1.15 && x.worse_in / x.videos >= 0.75))).sort((a2, b2) => b2.median_ratio! - a2.median_ratio!)[0];
  if (!top) return [];
  const ex = [...per[top.tag]].sort((a2, b2) => b2.ratio - a2.ratio).slice(0, 3);
  const cert = certaintyWords(top.videos, top.worse_in / top.videos >= 0.8 ? 0.95 : 0.88);
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
    metrics: { by_moment_type: summary, method: 'per-video ratio of relative loss per second during tagged moments vs untagged body of the same video; median across videos',
      learning: { kind: 'do', text: LABEL[top.tag].fix, why: `viewers leave ${speedCompare(top.median_ratio!)} in the rest of the same video during ${LABEL[top.tag].name.split(' (')[0]} (${top.worse_in} of ${top.videos} videos)`, topic: `moment:${top.tag}`, for_claude: true } satisfies Learning },
    compared_items: per[top.tag].map((x) => ({ publication_id: x.d.publication_id, content_item_id: x.d.content_item_id, content_code: x.d.content_code, title: x.d.title, platform: x.d.platform, group: clock(x.at), metric: 'times as fast', value: x.ratio })),
    segments: ex.map((x) => ({ publication_id: x.d.publication_id, content_item_id: x.d.content_item_id, segment_code: top.tag, start_sec: Math.max(0, x.at - 1), end_sec: x.at + 1 })),
    cohort: {}, rank_score: Math.min(1.6, 0.3 + (top.median_ratio! - 1) * W[cert.label] * 2), platform: null, rec_category: 'content', experiment: null,
  }];
}

function ctaReach(rows: PubRow[]): Finding[] {
  const out: Finding[] = [];
  for (const p of new Set(rows.map((r) => r.platform))) {
    const pr = rows.filter((r) => r.platform === p && r.derived.retention_at_cta != null && r.derived.retention_50pct != null);
    if (pr.length < 3) continue;
    const atCta = median(pr.map((r) => r.derived.retention_at_cta!)), atHalf = median(pr.map((r) => r.derived.retention_50pct!));
    if (atCta > 0.5) continue;
    const v = twoValues('retention_at_cta', atHalf, atCta);
    out.push({
      insight_type: 'cta_reach', headline: `${PLATFORM[p]}: only ${v.b} viewers are still there when the call to action starts`,
      story: {
        what_happened: `In a typical ${PLATFORM[p]} video, ${v.b} of the people who start watching are still there for the final part, where the call to action usually is. At the halfway point it is still ${v.a} — ${ratioWords(atHalf, atCta, 'people')}.`,
        why: 'A call to action placed only at the end is seen by the smallest audience the video has.',
        what_to_do: 'Add a short call to action (spoken or on screen) just before the halfway point, and keep the one at the end.',
        how_sure: `Measured directly from ${pr.length} videos' viewer data.`,
        impact: `Moving it to the halfway point puts it in front of ${ratioWords(atHalf, atCta, 'viewers')}.`,
      },
      certainty: pr.length >= 8 ? 'good evidence' : 'early signal', evidence_level: 'direct_data', sample_size: pr.length, effect_size: null, p_value: null,
      metrics: { platform: p, median_at_cta: atCta, median_at_half: atHalf,
        learning: { kind: 'do', text: 'Put a short call to action (spoken or on screen) just before the halfway point, and keep the one at the end', why: `on ${PLATFORM[p]} only ${v.b} viewers are still watching when the closing call to action starts, against ${v.a} at the halfway point`, topic: 'cta_position', for_claude: true, platforms: [p] } satisfies Learning },
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
      const v = twoValues(metric, mHi, mLo);
      // a difference must be big enough to matter and to be visible in words
      if (v.same || (metric === 'avg_view_ratio' ? mHi - mLo < 0.03 : mHi / (mLo || 1e-9) < 1.15)) continue;
      const f: Finding = {
        insight_type: 'platform_fit',
        headline: metric === 'avg_view_ratio' ? `The same video holds viewers better on ${PLATFORM[hi]} than on ${PLATFORM[lo]}` : `The same video gets more likes, comments, shares and saves on ${PLATFORM[hi]} than on ${PLATFORM[lo]}`,
        story: {
          what_happened: `${wins} of ${pairs.length} videos published on both did better on ${PLATFORM[hi]}. ${metric === 'avg_view_ratio'
            ? `Typically, people watch ${v.a} of the video on ${PLATFORM[hi]} and ${v.b} on ${PLATFORM[lo]}.`
            : `Typically, ${v.a} in every 1,000 viewers like, comment, share or save on ${PLATFORM[hi]}, against ${v.b} on ${PLATFORM[lo]}.`}`,
          why: 'Because the video is identical, the difference comes from the platform: its audience, how it is shown in the feed, and how people browse there.',
          what_to_do: metric === 'avg_view_ratio' ? `Make a ${PLATFORM[lo]}-specific edit (shorter, faster opening) instead of posting the same file, and prioritise ${PLATFORM[hi]} for this kind of content.` : `Use ${PLATFORM[hi]} for content meant to start conversations, and on ${PLATFORM[lo]} add a direct question or prompt in the caption to invite responses.`,
          how_sure: certaintyWords(pairs.length, wins / pairs.length >= 0.85 ? 0.95 : 0.9).sentence,
          impact: null,
        },
        certainty: certaintyWords(pairs.length, wins / pairs.length >= 0.85 ? 0.95 : 0.9).label, evidence_level: 'statistical_association', sample_size: pairs.length, effect_size: wins / pairs.length, p_value: null,
        metrics: { metric, better: hi, worse: lo, wins, pairs: pairs.length, median_better: mHi, median_worse: mLo,
          learning: (metric === 'avg_view_ratio'
            ? { kind: 'do', text: `For ${PLATFORM[lo]}, make a shorter cut with a faster opening instead of posting the same file`, why: `the same video is watched less on ${PLATFORM[lo]}: ${v.b} of it, against ${v.a} on ${PLATFORM[hi]}`, topic: `platform_hold:${lo}`, for_claude: true, platforms: [lo] }
            : { kind: 'do', text: `In the ${PLATFORM[lo]} caption, ask viewers a direct question to invite replies`, why: `the same video gets fewer reactions on ${PLATFORM[lo]}: ${v.b} in 1,000 viewers, against ${v.a} on ${PLATFORM[hi]}`, topic: `platform_eng:${lo}`, for_claude: true, platforms: [lo] }) satisfies Learning },
        compared_items: pairs.flatMap(([a, b]) => [a, b].map((r) => ({ publication_id: r.publication_id, content_item_id: r.content_item_id, content_code: r.content_code, title: r.title, platform: r.platform, metric, value: r.derived[metric] }))),
        segments: null, cohort: { metric, platforms: [hi, lo] }, rank_score: (wins / pairs.length) * 0.9, platform: hi, rec_category: 'platform', experiment: null,
      };
      if (!best || f.rank_score > best.rank_score) best = f;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Trend: one point per original video in publishing order, each scored against what is normal for its platform and length.
 * Mann–Kendall says whether there is a steady rise or fall; Theil–Sen says how big it is. Done for the overall score and for
 * each outcome, so the brief can say *what* is getting better or worse.
 */
const TREND_PHRASE: Record<string, (now: string, before: string, up: boolean, ago: string) => string> = {
  retention_3s: (n, b, up, ago) => `${n} viewers now stay past the first 3 seconds, ${up ? 'up' : 'down'} from ${b} ${ago}`,
  avg_view_ratio: (n, b, up, ago) => `people now watch ${n} of each video, ${up ? 'up' : 'down'} from ${b} ${ago}`,
  engagement_rate: (n, b, up, ago) => `${n} in 1,000 viewers now like, comment, share or save, ${up ? 'up' : 'down'} from ${b} ${ago}`,
  shares_saves_rate: (n, b, up, ago) => `${n} in 1,000 viewers now share or save, ${up ? 'up' : 'down'} from ${b} ${ago}`,
};
function trend(rows: PubRow[], diags: VideoDiag[]): { finding: Finding | null; line: string | null } {
  const pubAt = new Map(rows.map((r) => [r.publication_id, r.published_at ? Date.parse(r.published_at) : NaN]));
  const byVideo = new Map<string, VideoDiag[]>();
  for (const d of diags) if (d.z != null && Number.isFinite(pubAt.get(d.publication_id))) {
    const k = d.content_item_id ?? d.publication_id; byVideo.set(k, [...(byVideo.get(k) ?? []), d]);
  }
  const pts = [...byVideo.values()].map((ds) => ({ t: Math.min(...ds.map((d) => pubAt.get(d.publication_id)!)), z: mean(ds.map((d) => d.z!)), ds })).sort((x, y) => x.t - y.t);
  if (pts.length < 8) return { finding: null, line: null };
  const days = pts.map((x) => (x.t - pts[0].t) / 864e5), span = days.at(-1)! || 1;
  const ago = span >= 45 ? `${Math.round(span / 30.4)} months ago` : `${Math.round(span / 7)} weeks ago`;
  const overall = mannKendall(pts.map((x) => x.z));
  const moves: { outcome: string; up: boolean; p: number; text: string }[] = [];
  for (const outcome of Object.keys(TREND_PHRASE)) {
    const series = pts.map((x, i) => {
      const e = x.ds.map((d) => d.expected[outcome]).filter(Boolean);
      return e.length ? { day: days[i], resid: mean(e.map((v) => v.actual - v.expected)), exp: mean(e.map((v) => v.expected)) } : null;
    }).filter(Boolean) as { day: number; resid: number; exp: number }[];
    if (series.length < 8) continue;
    const mk = mannKendall(series.map((x) => x.resid));
    if (mk.p > 0.1) continue;
    const ts = theilSen(series.map((x) => x.day), series.map((x) => x.resid));
    const typical = median(series.map((x) => x.exp));
    const before = Math.max(0, typical + ts.intercept + ts.slope * series[0].day), now = Math.max(0, typical + ts.intercept + ts.slope * series.at(-1)!.day);
    const v = twoValues(outcome, now, before);
    if (v.same) continue;
    moves.push({ outcome, up: now > before, p: mk.p, text: TREND_PHRASE[outcome](v.a, v.b, now > before, ago) });
  }
  if (overall.p > 0.1 && !moves.length) return { finding: null, line: `Steady: no clear rise or fall across your last ${pts.length} videos.` };
  const ups = moves.filter((m) => m.up), downs = moves.filter((m) => !m.up);
  const better = overall.p <= 0.1 ? overall.s > 0 : ups.length >= downs.length;
  const mixed = ups.length > 0 && downs.length > 0;
  const p = Math.min(overall.p, ...moves.map((m) => m.p));
  const cert = certaintyWords(pts.length, 1 - p / 2);
  const headline = mixed ? `Mixed trend: ${OUTCOME_PLAIN[ups[0].outcome].name} is improving, ${OUTCOME_PLAIN[downs[0].outcome].name} is slipping`
    : better ? 'Your videos are getting better over time' : 'Your videos are slipping over time';
  const detail = moves.length ? moves.map((m) => m.text).join('; ') : better ? 'the overall score is rising' : 'the overall score is falling';
  return {
    line: `${mixed ? 'Mixed' : better ? 'Improving' : 'Slipping'}: ${detail.split('; ')[0]}.`,
    finding: {
      insight_type: 'trend', headline,
      story: {
        what_happened: `Looking at your ${pts.length} videos in the order they were published, each compared with what is normal for its platform and length: ${detail}.`,
        why: mixed ? 'Different parts of the videos are moving in different directions, so look at what changed in each part separately.'
          : better ? 'Something in how the recent videos are made is working.' : 'Something changed in the recent videos — format, topics, timing or audience — and it is costing attention.',
        what_to_do: mixed || !better ? 'Open a recent weak video next to an older strong one and compare the opening, the pace and the length.'
          : 'Keep the recent approach and write down what changed, so it becomes the standard.',
        how_sure: `${cert.sentence} Trend test: Mann–Kendall, size of the change: Theil–Sen line.`, impact: null,
      },
      certainty: cert.label, evidence_level: 'statistical_association', sample_size: pts.length, effect_size: overall.tau, p_value: p,
      metrics: { tau: overall.tau, p_overall: overall.p, moves, span_days: span }, compared_items: [], segments: null, cohort: {},
      rank_score: 0.5 + (moves.length ? 0.1 : 0), platform: null, rec_category: 'content', experiment: null,
    },
  };
}

/**
 * Popularity: breakout videos got at least twice the usual views (the median of the same platform, counted once a post is a week old).
 * Then: which traits do the breakouts share far more often than the rest (one-sided Fisher exact test)?
 */
const BREAKOUT_FEATURES = ['opening_style', 'product_shown_in_opening', 'opening_has_narration', 'editing_pace', 'cta_type', 'category', 'edit_style', 'duration_bucket', 'publish_slot'];
function breakouts(rows: PubRow[], tz: string): Finding[] {
  const mature = rows.filter((r) => r.metrics.views != null && (r.derived.age_days ?? 99) >= 7);
  const usual = new Map<string, number>();
  for (const p of new Set(mature.map((r) => r.platform))) {
    const v = mature.filter((r) => r.platform === p).map((r) => r.metrics.views!);
    if (v.length >= 5) usual.set(p, median(v));
  }
  const best = new Map<string, { r: PubRow; mult: number }>();
  for (const r of mature) {
    const u = usual.get(r.platform);
    if (!u) continue;
    const k = r.content_item_id ?? r.publication_id, mult = r.metrics.views! / u;
    if (!best.has(k) || best.get(k)!.mult < mult) best.set(k, { r, mult });
  }
  const vids = [...best.values()], n = vids.length;
  const brk = vids.filter((v) => v.mult >= 2).sort((a, b) => b.mult - a.mult), k = brk.length;
  if (n < 8 || k < 2 || n - k < 4) return [];
  const levelOf = (r: PubRow, f: string) => (f === 'publish_slot' ? (r.published_at ? slotOf(r.published_at, tz) : null) : r.features[f] == null ? null : String(r.features[f]));
  // every trait value is tested, and the p-values are corrected for testing so many (otherwise some trait always "matches" by chance)
  const tested: { feature: string; level: string; a: number; m: number; restShare: number; p: number; q?: number }[] = [];
  for (const f of BREAKOUT_FEATURES) {
    const lv = new Set(vids.map((v) => levelOf(v.r, f)).filter((x): x is string => x != null && x !== 'unknown'));
    for (const L of lv) {
      const a = brk.filter((v) => levelOf(v.r, f) === L).length, m = vids.filter((v) => levelOf(v.r, f) === L).length;
      tested.push({ feature: f, level: L, a, m, restShare: (m - a) / (n - k), p: a ? fisherUpper(a, k, m, n) : 1 });
    }
  }
  const qs = benjaminiHochberg(tested.map((t) => t.p));
  tested.forEach((t, i) => (t.q = qs[i]));
  const traits = tested.filter((t) => t.a >= 2 && t.a / k >= 0.6 && t.a / k - t.restShare >= 0.3 && t.q! <= 0.25).sort((x, y) => x.q! - y.q!);
  const top = traits.filter((t, i) => traits.findIndex((u) => u.feature === t.feature) === i).slice(0, 2);
  const lead = top[0];
  // views are the noisiest number: a shared trait is at most "good evidence", and only with a corrected p of 0.05 or less
  const certainty: Finding['certainty'] = !lead ? 'early signal' : lead.q! <= 0.05 && n >= 8 ? 'good evidence' : 'early signal';
  const cert = lead ? { label: certainty, sentence: certainty === 'good evidence'
    ? `Good evidence: across ${n} videos this is unlikely to be chance, even after allowing for the ${tested.length} traits that were checked. Views are noisy, so treat it as a strong lead and test it.`
    : `Early signal: across ${n} videos, after allowing for the ${tested.length} traits that were checked, this could still be chance. Worth testing on the next videos.` } : null;
  const times = (x: number) => (x >= 2.5 ? `about ${Math.round(x)} times` : 'about twice');
  const traitTxt = (t: typeof top[number]) => `${t.a === k ? `All ${k}` : `${t.a} of the ${k}`} ${featurePlain(t.feature, t.level)}, against ${inTen(t.restShare)} of your other videos.`;
  return [{
    insight_type: 'breakout',
    headline: `${k} of your ${n} videos got more than twice your usual views${lead ? ` — ${lead.a === k ? 'all of them' : `${lead.a} of them`} ${featurePlain(lead.feature, lead.level)}` : ''}`,
    story: {
      what_happened: `Each video's views were compared with the usual (median) views on the same platform, once it was at least a week old. These reached more than twice the usual: ${brk.slice(0, 4).map((v) => `"${short(v.r.title)}" (${times(v.mult)} the usual on ${PLATFORM[v.r.platform]})`).join('; ')}${k > 4 ? ` and ${k - 4} more` : ''}.${top.length ? ` ${top.map(traitTxt).join(' ')}` : ' They do not share one clear trait yet.'}`,
      why: 'Views depend partly on how much each platform chose to show a video, so they are the noisiest number we have. What the breakouts share is a strong lead, not proof.',
      what_to_do: lead ? `Make the next video the way these were made: ${actionPlain(lead.feature, lead.level)}. Watch the breakout videos again and copy what works in their first seconds.`
        : 'Watch these videos again side by side and note what they do differently in the first seconds.',
      how_sure: cert ? cert.sentence : `The views are measured; none of the ${tested.length} traits checked is shared by the breakouts clearly enough yet.`,
      impact: null,
    },
    certainty, evidence_level: lead ? 'statistical_association' : 'direct_data', sample_size: n, effect_size: lead ? lead.a / k - lead.restShare : null, p_value: lead?.q ?? null,
    metrics: { usual_views: Object.fromEntries(usual), breakouts: brk.map((v) => ({ publication_id: v.r.publication_id, title: v.r.title, platform: v.r.platform, times_usual: v.mult })), traits: top,
      method: 'views ÷ same-platform median (posts ≥ 7 days old), best platform per original video, breakout ≥ 2×; traits by one-sided Fisher exact test with Benjamini–Hochberg correction', traits_tested: tested.length,
      ...(lead ? { learning: { kind: 'do', text: cap(actionPlain(lead.feature, lead.level)), why: `${lead.a} of your ${k} breakout videos (more than twice the usual views) did this, against ${inTen(lead.restShare)} of the others`, topic: `${lead.feature}=${lead.level}`, for_claude: !NOT_EDITING.has(lead.feature), ...(lead.feature === 'edit_style' ? { style: lead.level } : {}) } satisfies Learning } : {}) },
    compared_items: vids.sort((a, b) => b.mult - a.mult).map((v) => ({ publication_id: v.r.publication_id, content_item_id: v.r.content_item_id, content_code: v.r.content_code, title: v.r.title, platform: v.r.platform,
      group: v.mult >= 2 ? 'breakout' : 'other', metric: 'times usual views', value: v.mult })),
    segments: null, cohort: {}, rank_score: lead ? 0.5 + 0.6 * W[certainty] : 0.35, platform: null, rec_category: 'content', experiment: null,
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
const REASON_WEIGHT: Record<string, number> = { avg_view_ratio: 1.5, retention_3s: 1, engagement_rate: 1, shares_saves_rate: 0.75 };
/** Why a video is among the best or weakest: its one or two clearest differences from what is usual, in words that show a real difference. */
function reasonFor(d: VideoDiag, good: boolean): string | null {
  const parts = Object.entries(d.expected)
    .filter(([k, v]) => (good ? v.z >= 0.5 : v.z <= -0.5) && (OUTCOME_PLAIN[k]?.unit === 'share' || Math.abs(v.actual / (v.expected || 1e-9) - 1) >= 0.15))
    .sort((x, y) => Math.abs(y[1].z) * (REASON_WEIGHT[y[0]] ?? 1) - Math.abs(x[1].z) * (REASON_WEIGHT[x[0]] ?? 1))
    .map(([k, v]) => {
      const t = twoValues(k, v.actual, v.expected);
      if (t.same) return null;
      const usual = t.b.replace(/^about /, '');
      switch (k) {
        case 'retention_3s': return `${t.a} stayed past 3 seconds (usually ${usual})`;
        case 'avg_view_ratio': return `people watched ${t.a} of it (usually ${usual})`;
        case 'engagement_rate': return `${t.a.replace(/^about /, '')} in 1,000 viewers liked, commented, shared or saved (usually ${usual})`;
        case 'shares_saves_rate': return `${t.a.replace(/^about /, '')} in 1,000 viewers shared or saved it (usually ${usual})`;
        default: return null;
      }
    }).filter(Boolean).slice(0, 2) as string[];
  return parts.length ? cap(parts.join('; ')) : null;
}

function buildBrief(rows: PubRow[], diags: VideoDiag[], findings: Finding[], scope: string, extra: { trend: string | null; too_new: number }) {
  const graded = diags.filter((d) => d.grade);
  const real = findings.filter((f) => f.insight_type !== 'data_coverage').sort((a, b) => b.rank_score - a.rank_score);
  const pattern = real.find((f) => f.insight_type === 'curve_pattern');
  const topDriver = real.find((f) => f.insight_type === 'driver' || (f.insight_type === 'breakout' && (f.metrics as any).learning));
  const pick = (xs: VideoDiag[], good: boolean) => xs.map((d) => ({ d, why: reasonFor(d, good) })).filter((x) => x.why)
    .filter((x, i, arr) => arr.findIndex((y) => (y.d.content_item_id ?? y.d.publication_id) === (x.d.content_item_id ?? x.d.publication_id)) === i).slice(0, 3);
  const wins = pick([...graded].filter((d) => d.z! > 0.35).sort((a, b) => b.z! - a.z!), true);
  const problems = pick([...graded].filter((d) => d.z! < -0.35).sort((a, b) => a.z! - b.z!), false);
  const views = rows.reduce((s, r) => s + (r.metrics.views ?? 0), 0);
  const interactions = rows.reduce((s, r) => s + (r.metrics.likes ?? r.metrics.reactions ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0) + (r.metrics.saves ?? 0), 0);
  const watchMin = rows.reduce((s, r) => s + (r.metrics.total_watch_time_sec ?? 0), 0) / 60;
  const watched = median(rows.map((r) => r.derived.avg_view_ratio).filter((x): x is number => x != null));
  const pm: any = pattern?.metrics;
  const problemTxt = pm ? `${pm.videos_with_shape} of ${pm.videos} ${PLATFORM[pm.platform]} videos ${SHAPE_VERB[pm.shape]}` : null;
  const lt: Learning | undefined = (topDriver?.metrics as any)?.learning;
  const oppTxt = lt ? lt.text.charAt(0).toLowerCase() + lt.text.slice(1) : null;
  const headline = [problemTxt && cap(problemTxt) + '.', oppTxt && `Biggest opportunity: ${oppTxt}${topDriver!.certainty === 'early signal' ? ' (early signal — test it first)' : ''}.`].filter(Boolean).join(' ');
  return {
    scope,
    headline: headline || (real[0]?.headline ?? 'Not enough data for a summary yet.'),
    trend: extra.trend,
    numbers: [
      { label: 'Videos analysed', value: n0(new Set(rows.map((r) => r.content_item_id ?? r.publication_id)).size), note: `${rows.length} posts across ${new Set(rows.map((r) => r.platform)).size} platforms` },
      { label: 'Views', value: n0(views), note: 'each platform counts views its own way' },
      { label: 'Likes, comments, shares and saves', value: n0(interactions), note: views ? `about ${Math.round((1000 * interactions) / views)} per 1,000 views` : '' },
      { label: 'Time spent watching', value: watchMin >= 600 ? `${n0(watchMin / 60)} hours` : `${n0(watchMin)} minutes`, note: Number.isFinite(watched) ? `a typical viewer watches ${twoValues('avg_view_ratio', watched, watched).a} of a video` : '' },
    ],
    wins: wins.map(({ d, why }) => ({ publication_id: d.publication_id, title: d.title, platform: d.platform, grade: d.grade, text: `${cap(d.grade_words!)}: ${why}.` })),
    problems: problems.map(({ d, why }) => ({ publication_id: d.publication_id, title: d.title, platform: d.platform, grade: d.grade, text: `${cap(d.grade_words!)}: ${why}.` })),
    actions: mergeActions(real.filter((f) => f.story.what_to_do)).slice(0, 4),
    data_health: [
      ...findings.filter((f) => f.insight_type === 'data_coverage').map((f) => f.headline),
      ...(extra.too_new ? [`${extra.too_new} post${extra.too_new === 1 ? ' is' : 's are'} less than 2 days old and not judged yet.`] : []),
    ],
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
        out[prev.idx] = { ...out[prev.idx], action: `In your ${prev.platforms.join(' and ')} videos, ${fix.charAt(0).toLowerCase()}${fix.slice(1)}`, title: prev.titles.join('; ') };
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
/** The whole analysis without the database: rows in, findings + per-video diagnostics + brief out. */
export const MIN_AGE_DAYS = 2;
export function analyse(allRows: PubRow[], cfg: any, tz: string, scope: string) {
  // Too-new posts are left out of comparisons: their numbers have not settled yet.
  const rows = allRows.filter((r) => r.derived.age_days == null || r.derived.age_days >= MIN_AGE_DAYS);
  const diags = videoDiagnostics(rows);
  const { findings: drivers, models } = rows.length ? driverFindings(rows, cfg, tz) : { findings: [], models: {} };
  const tr = trend(rows, diags);
  const findings: Finding[] = [
    ...drivers, ...curvePatterns(rows, diags), ...contentRisk(rows, diags), ...ctaReach(rows), ...crossPlatform(rows), ...breakouts(rows, tz),
    ...(tr.finding ? [tr.finding] : []), ...dataGaps(rows, scope, cfg),
  ].sort((a, b) => b.rank_score - a.rank_score);
  const brief = buildBrief(rows, diags, findings, scope, { trend: tr.line, too_new: allRows.length - rows.length });
  return { rows, diags, findings, models, brief };
}

export const DEFAULT_ANALYSIS = { min_sample_preliminary: 4, min_sample_moderate: 8, min_sample_strong: 15, alpha: 0.05, bootstrap_iterations: 400 };

export async function runIntelligence(opts: { scope?: 'live' | 'demo'; userId?: string } = {}) {
  const scope = opts.scope ?? 'live';
  const cfg = await settings();
  const tz = (await one<any>(`SELECT value FROM app_settings WHERE key='company'`))?.value?.timezone ?? 'Asia/Kolkata';
  const { rows, diags, findings, models, brief } = analyse(await loadDataset(scope), cfg, tz, scope);
  const runId = crypto.randomUUID();

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
       f.experiment ? `Make about ${f.experiment.per_arm} videos with "${f.experiment.a.replace(/_/g, ' ')}" and compare them with ${f.experiment.b === 'the rest' ? 'the rest' : `"${f.experiment.b.replace(/_/g, ' ')}"`}.` : null,
       JSON.stringify(f.cohort), f.narrative_source ?? 'template', origin, f.headline, JSON.stringify(f.story), f.certainty, f.rank_score]);
    if (f.story.what_to_do && (f.certainty !== 'not enough data' || f.rec_category === 'data')) {
      const rec = await one<{ id: string }>(
        `INSERT INTO ai_recommendations (run_id, category, title, body, platform_code, confidence, insight_ids, priority, data_origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [runId, f.rec_category, f.story.what_to_do.replace(/^For the next videos: /, '').split('. ')[0].replace(/\.$/, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 160),
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
  await q(`INSERT INTO ai_briefs (run_id, data_origin, brief) VALUES ($1,$2,$3)`, [runId, origin, JSON.stringify(brief)]);
  const coverage = { publications: rows.length, with_retention_curve: rows.filter((r) => r.curve).length, with_video_analysis: rows.filter((r) => r.features.opening_style != null).length };
  return { runId, scope, insights: findings.length, coverage, models: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, { videos: v.videos, r2: Number(v.r2.toFixed(2)) }])) };
}

export { shrinkGroups };

/** Internal steps, exported for tests. */
export const _internals = { driverFindings, curvePatterns, contentRisk, ctaReach, crossPlatform, breakouts, trend };
