/**
 * Plain-language layer. Turns numbers into sentences a content head or CEO can act on:
 *  - shares as natural frequencies ("3 in 10 viewers"), which people read more accurately than percentages
 *  - comparisons as ratios in words ("half as many", "about twice as many")
 *  - positions in words ("the weakest of 6 similar videos") instead of percentiles
 *  - certainty in words ("early signal, based on 6 videos") instead of p-values
 */

/** 0.33 → "3 in 10". Small shares use "1 in N". */
export function inTen(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return 'an unknown share';
  const s = Math.max(0, share);
  if (s >= 0.95 && s <= 1.05) return 'almost all';
  if (s > 1.05) return 'more than all (people rewatched)';
  if (s < 0.05) return s <= 0 ? 'none' : `about 1 in ${Math.round(1 / s)}`;
  if (s < 0.095) return `about 1 in ${Math.round(1 / s)}`;
  return `${Math.round(s * 10)} in 10`;
}

/** Ratio a/b in words: "twice as many", "half as many", "about the same". */
export function ratioWords(a: number, b: number, noun = ''): string {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return '';
  const r = a / b;
  const n = noun ? ` ${noun}` : '';
  if (r >= 0.9 && r <= 1.1) return `about the same${n}`;
  if (r > 1.1 && r < 1.2) return `slightly more${n}`;
  if (r >= 1.2 && r < 1.3) return `about a quarter more${n}`;
  if (r >= 1.3 && r < 1.45) return `about a third more${n}`;
  if (r >= 1.45 && r < 1.75) return `about one and a half times as many${n}`;
  if (r >= 1.75 && r < 2.5) return `about twice as many${n}`;
  if (r >= 2.5) return `about ${Math.round(r)} times as many${n}`;
  if (r < 0.9 && r >= 0.8) return `slightly fewer${n}`;
  if (r < 0.8 && r >= 0.7) return `about a quarter fewer${n}`;
  if (r < 0.7 && r >= 0.58) return `about a third fewer${n}`;
  if (r < 0.58 && r > 0.4) return `about half as many${n}`;
  if (r <= 0.4 && r > 0.28) return `about a third as many${n}`;
  return `far fewer${n} (about 1 for every ${Math.round(1 / r)})`;
}

export function rankWords(rank: number, of: number, what = 'similar videos'): string {
  if (of <= 1) return '';
  if (rank === 1) return `the best of ${of} ${what}`;
  if (rank === of) return `the weakest of ${of} ${what}`;
  if (rank === 2) return `the second best of ${of} ${what}`;
  if (rank === of - 1) return `the second weakest of ${of} ${what}`;
  return rank <= of / 2 ? `in the top half of ${of} ${what}` : `in the bottom half of ${of} ${what}`;
}

export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const pts = (diff: number) => `${Math.abs(Math.round(diff * 100))} percentage points`;

export const PLATFORM: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', all: 'all platforms' };

export const FEATURE_PLAIN: Record<string, Record<string, string>> = {
  opening_style: {
    product_demo_first: 'open by showing the product in action', problem_first: 'open with the customer\'s problem',
    question: 'open with a question', company_intro: 'open by introducing the company', slow_cinematic: 'open with a slow cinematic shot',
    direct_statement: 'open with a direct statement',
  },
  product_shown_in_opening: { yes: 'show the product within the first 2 seconds', no: 'do not show the product in the first 2 seconds' },
  opening_has_narration: { yes: 'start talking in the first 3 seconds', no: 'have no voice in the first 3 seconds' },
  editing_pace: { fast: 'use fast cuts (a new shot every 3 seconds or less)', medium: 'use a medium editing pace (a new shot every 3–10 seconds)', slow: 'use slow editing (shots longer than 10 seconds)' },
  cta_type: { website: 'end by pointing viewers to the website', enquiry: 'end by asking viewers to get in touch', follow: 'end by asking viewers to follow or subscribe', purchase: 'end with a buy/order call', dm: 'end by asking viewers to message', none: 'have no call to action' },
  edit_style: { clean: 'use the clean cut with captions', branded: 'use the branded edit (logo, name card, end card)', motion: 'use the split-screen motion-graphics edit', overlay: 'use the full video with floating graphics', editorial: 'use the 3D Explainer style (full-screen 3D explainers between the speaker shots)', hype: 'use the Bold & Fast style', cinematic: 'use the Cinematic Story style', minimal: 'use the Clean & Minimal style',
    paper_cutout: 'use the Paper Cut-Out style', particles: 'use the Generative Particles style', liquid_glass: 'use the Liquid Glass style', kinetic_type: 'use the Kinetic Typography style',
    isometric: 'use the Isometric Line Art style', flat_vector: 'use the Flat Vector style', risograph: 'use the Risograph Print style', pixel_art: 'use the 8-Bit Pixel Art style',
    simple_edit: 'use the Simple Edit style (clean cuts of real footage)' },
  ai_edited: { yes: 'are edited with Claude Code from the Studio', no: 'are edited by hand' },
  duration_bucket: { '0-15s': 'are under 15 seconds', '15-30s': 'are 15–30 seconds long', '30-60s': 'are 30–60 seconds long', '1-3min': 'are 1–3 minutes long', '3min+': 'are longer than 3 minutes' },
};
export function featurePlain(feature: string, value: string): string {
  const v = FEATURE_PLAIN[feature]?.[value];
  if (v) return v;
  if (feature === 'category') return `are "${value.replace(/_/g, ' ')}" videos`;
  if (feature === 'edit_style' && value.startsWith('ref_')) return `use the "${value.slice(4).replace(/_/g, ' ')}" style learned from a reference video`;
  if (feature === 'edit_style' && value.startsWith('pack_')) return `use the "${value.slice(5).replace(/_/g, ' ')}" style pack`;
  if (feature === 'edit_style') return `use the "${value.replace(/_/g, ' ')}" style`;
  if (feature === 'publish_slot') return `are published in the ${value}`;
  if (feature === 'publish_day') return `are published on ${value}`;
  return `have ${feature.replace(/_/g, ' ')} "${value.replace(/_/g, ' ')}"`;
}

export const OUTCOME_PLAIN: Record<string, { name: string; unit: 'share' | 'rate' | 'per1k' | 'count'; sentence: (v: number) => string }> = {
  retention_3s: { name: 'viewers who stay past the first 3 seconds', unit: 'share', sentence: (v) => `${inTen(v)} viewers stay past the first 3 seconds` },
  retention_8s: { name: 'viewers who stay past 8 seconds', unit: 'share', sentence: (v) => `${inTen(v)} viewers are still watching at 8 seconds` },
  retention_50pct: { name: 'viewers still watching at the halfway point', unit: 'share', sentence: (v) => `${inTen(v)} viewers are still there at the halfway point` },
  retention_at_cta: { name: 'viewers who reach the call to action', unit: 'share', sentence: (v) => `${inTen(v)} viewers reach the call to action` },
  avg_view_ratio: { name: 'how much of the video people watch', unit: 'share', sentence: (v) => `people watch ${fractionWords(v)} of the video on average` },
  engagement_rate: { name: 'likes, comments, shares and saves per viewer', unit: 'rate', sentence: (v) => `${per1000(v)} in every 1,000 viewers like, comment, share or save` },
  shares_saves_rate: { name: 'shares and saves per viewer', unit: 'rate', sentence: (v) => `${per1000(v)} in every 1,000 viewers share or save it` },
};

/** Difference between two values of an outcome, in words a manager understands. */
export function diffWords(outcome: string, a: number, b: number): string {
  const o = OUTCOME_PLAIN[outcome];
  if (!o) return '';
  if (o.unit === 'share') {
    const d = Math.round((a - b) * 10);
    if (d === 0) return 'about the same share of viewers';
    return `${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} viewer${Math.abs(d) === 1 ? '' : 's'} out of every 10`;
  }
  return ratioWords(a, b);
}

/** Certainty in words. probDir = probability the effect has the stated direction (from the bootstrap). */
export function certaintyWords(n: number, probDir: number | null, minN = 4): { label: 'strong evidence' | 'good evidence' | 'early signal' | 'not enough data'; sentence: string } {
  if (n < minN || probDir == null) return { label: 'not enough data', sentence: `Not enough data yet: only ${n} video${n === 1 ? '' : 's'} can be compared. Treat this as a lead to check, not a conclusion.` };
  if (n >= 15 && probDir >= 0.97) return { label: 'strong evidence', sentence: `Strong evidence: seen consistently across ${n} videos, and very unlikely to be chance. It is still a pattern, not proof of cause, so confirm with a test before changing everything.` };
  if (n >= 8 && probDir >= 0.9) return { label: 'good evidence', sentence: `Good evidence: consistent across ${n} videos and unlikely to be chance (about ${Math.min(99, Math.round(probDir * 100))} in 100 confident it points the right way). Worth acting on and testing.` };
  return { label: 'early signal', sentence: `Early signal: based on ${n} videos, so it could still change as more videos come in. Worth testing on the next few videos before making it standard.` };
}

/**
 * Certainty for a tested pattern, from its false-discovery-adjusted p-value (q) — not from how often re-samples agree,
 * which is optimistic with few videos. minGroup = videos in the smaller of the two groups compared.
 * Returns null when the pattern should not be shown at all.
 */
export function certaintyFromTest(n: number, q: number, minGroup: number, minN = 4): { label: 'strong evidence' | 'good evidence' | 'early signal' | 'not enough data'; sentence: string } | null {
  if (n < minN) return { label: 'not enough data', sentence: `Not enough data yet: only ${n} video${n === 1 ? '' : 's'} can be compared. Treat this as a lead to check, not a conclusion.` };
  if (q <= 0.05 && n >= 15 && minGroup >= 5) return { label: 'strong evidence', sentence: `Strong evidence: seen consistently across ${n} videos, and very unlikely to be chance even after allowing for every other pattern we checked. It is still a pattern, not proof of cause, so confirm with a test before changing everything.` };
  if (q <= 0.1 && n >= 8 && minGroup >= 3) return { label: 'good evidence', sentence: `Good evidence: consistent across ${n} videos and unlikely to be chance, even after allowing for the other patterns we checked. Worth acting on and testing.` };
  if (q <= 0.15) return { label: 'early signal', sentence: `Early signal: based on ${n} videos. After allowing for the other patterns we checked, it could still be chance. Worth testing on the next few videos before making it standard.` };
  return null;
}

/** Lehr's rule of thumb: videos needed per variant to detect a standardised effect d with ~80% power. */
export function videosNeeded(d: number) {
  if (!Number.isFinite(d) || Math.abs(d) < 0.05) return null;
  return Math.min(200, Math.max(3, Math.ceil(16 / (d * d))));
}

/** 0.44 → "about two fifths"; 0.34 → "about a third". */
export function fractionWords(v: number): string {
  const opts: [number, string][] = [[0.05, 'almost none'], [0.1, 'about a tenth'], [0.17, 'about a sixth'], [0.2, 'about a fifth'], [0.25, 'about a quarter'], [0.33, 'about a third'], [0.4, 'about two fifths'], [0.5, 'about half'], [0.6, 'about three fifths'], [0.67, 'about two thirds'], [0.75, 'about three quarters'], [0.9, 'almost all'], [1, 'all']];
  if (v > 1.05) return 'more than all of it (people rewatched)';
  return opts.reduce((best, o) => (Math.abs(o[0] - v) < Math.abs(best[0] - v) ? o : best))[1];
}
export const per1000 = (rate: number) => (rate * 1000 < 1 ? 'fewer than 1' : `about ${Math.round(rate * 1000)}`);

/** "68 in 100" — used when "in 10" would hide or distort a difference. */
export const inHundred = (v: number) => (v >= 0.995 ? 'almost all' : v < 0.01 ? 'fewer than 1 in 100' : `${Math.round(v * 100)} in 100`);

/**
 * Two values of the same outcome in words that never contradict the comparison:
 * if "in 10" makes them look equal (or distorts their ratio) they are given "in 100"; fractions fall back to percentages.
 * `same` is true when even the finer wording cannot tell them apart — then the difference must not be presented.
 */
export function twoValues(outcome: string, a: number, b: number): { a: string; b: string; same: boolean } {
  const unit = OUTCOME_PLAIN[outcome]?.unit ?? 'share';
  if (outcome === 'avg_view_ratio') {
    const fa = fractionWords(a), fb = fractionWords(b);
    if (fa !== fb) return { a: fa, b: fb, same: false };
    const pa = `${Math.round(a * 100)}%`, pb = `${Math.round(b * 100)}%`;
    return { a: pa, b: pb, same: pa === pb };
  }
  if (unit === 'share') {
    const ta = inTen(a), tb = inTen(b);
    const ra = Math.round(a * 10), rb = Math.round(b * 10);
    const consistent = ta !== tb && rb > 0 && b > 0 && Math.abs(ra / rb - a / b) / (a / b) <= 0.2; // rounding keeps the ratio within 20%
    if (consistent) return { a: ta, b: tb, same: false };
    const ha = inHundred(a), hb = inHundred(b);
    return { a: ha, b: hb, same: ha === hb };
  }
  const pa = per1000(a), pb = per1000(b);
  return { a: pa, b: pb, same: pa === pb };
}

/** Two-sentence comparison of an outcome between videos with a trait and the others (or a named other group). */
/** 'are "company intro" videos' reads badly after "videos that": name the kind of video directly. */
const kindOf = (levelTxt: string) => levelTxt.match(/^are "(.+)" videos$/)?.[1] ?? null;
const inVideos = (levelTxt: string) => (kindOf(levelTxt) ? `In "${kindOf(levelTxt)}" videos` : `In videos that ${levelTxt}`);
const subjectOf = (levelTxt: string) => { const k = kindOf(levelTxt); return k ? `"${k.charAt(0).toUpperCase()}${k.slice(1)}" videos` : `Videos that ${levelTxt}`; };

export function compareSentence(outcome: string, levelTxt: string, a: number, otherTxt: string | null, b: number): string {
  const v = twoValues(outcome, a, b);
  const other = otherTxt ? inVideos(otherTxt) : 'In your other videos', lv = inVideos(levelTxt);
  switch (outcome) {
    case 'retention_3s': return `${lv}, ${v.a} viewers stay past the first 3 seconds. ${other}, ${v.b} do.`;
    case 'retention_8s': return `${lv}, ${v.a} viewers are still watching at 8 seconds. ${other}, ${v.b} are.`;
    case 'avg_view_ratio': return `${lv}, people watch ${v.a} of the video on average. ${other}, they watch ${v.b}.`;
    case 'engagement_rate': return `${lv}, ${v.a} in every 1,000 viewers like, comment, share or save. ${other}, ${v.b} do.`;
    case 'shares_saves_rate': return `${lv}, ${v.a} in every 1,000 viewers share or save the video. ${other}, ${v.b} do.`;
    default: return `${OUTCOME_PLAIN[outcome]?.name ?? outcome}: ${a.toFixed(2)} vs ${b.toFixed(2)}.`;
  }
}
/** Headline for a comparison; works in both directions ("keep 2 more" / "keep 2 fewer"). `vs` names the comparison group. */
export function compareHeadline(outcome: string, levelTxt: string, a: number, b: number, vs?: string): string {
  const than = vs ? ` than ${vs}` : '';
  switch (outcome) {
    case 'retention_3s': {
      // same rounding as the sentence that follows the headline, so the two never disagree
      const tenths = twoValues(outcome, a, b).a.endsWith('in 10');
      const unit = tenths ? 10 : 100;
      let d = Math.round(a * unit) - Math.round(b * unit);
      if (d === 0) d = a >= b ? 1 : -1;
      const n = Math.abs(d);
      return `${subjectOf(levelTxt)} keep ${n} ${d > 0 ? 'more' : 'fewer'} viewer${n === 1 ? '' : 's'} in ${unit} past the first 3 seconds${than}`;
    }
    case 'avg_view_ratio': {
      const v = twoValues(outcome, a, b);
      return `${subjectOf(levelTxt)} are watched for ${a >= b ? 'longer' : 'less time'}${than} — ${v.a} of the video on average, against ${v.b}`;
    }
    case 'engagement_rate': return `${subjectOf(levelTxt)} get ${ratioWords(a, b)} likes, comments, shares and saves${than}`;
    case 'shares_saves_rate': return `${subjectOf(levelTxt)} get ${ratioWords(a, b)} shares and saves${than}`;
    default: return `${subjectOf(levelTxt)} do ${a >= b ? 'better' : 'worse'} on ${OUTCOME_PLAIN[outcome]?.name ?? outcome}${than}`;
  }
}
/** What to stop doing, in the same grammar as actionPlain. */
export function avoidPlain(feature: string, value: string): string {
  if (feature === 'category') return `make fewer "${value.replace(/_/g, ' ')}" videos`;
  if (feature === 'publish_slot') return `avoid publishing in the ${value}`;
  return `avoid videos that ${featurePlain(feature, value)}`;
}
/** Imperative form for "what to do". */
export function actionPlain(feature: string, value: string): string {
  if (feature === 'category') return `make more "${value.replace(/_/g, ' ')}" videos`;
  if (feature === 'publish_slot') return `publish in the ${value}`;
  if (feature === 'duration_bucket') return `keep videos ${({ '0-15s': 'under 15 seconds', '15-30s': '15–30 seconds long', '30-60s': '30–60 seconds long', '1-3min': '1–3 minutes long', '3min+': 'longer than 3 minutes' } as Record<string, string>)[value] ?? value}`;
  return featurePlain(feature, value);
}

/** Compact value for lists: "7 in 10 stayed past 3 seconds", "watched about half", "53 in 1,000 viewers engaged". */
export function shortValue(outcome: string, v: number): string {
  switch (outcome) {
    case 'retention_3s': return `${inTen(v)} stayed past 3 seconds`;
    case 'avg_view_ratio': return `watched ${fractionWords(v)} of it`;
    case 'engagement_rate': return `${per1000(v).replace('about ', '')} in 1,000 viewers engaged`;
    case 'shares_saves_rate': return `${per1000(v).replace('about ', '')} in 1,000 viewers shared or saved it`;
    default: return v.toFixed(2);
  }
}
export const SHAPE_VERB: Record<string, string> = {
  hook_failure: 'lose most viewers in the first seconds', mid_collapse: 'lose many viewers at one moment in the middle',
  slow_bleed: 'keep losing viewers steadily after a good start', ending_drop: 'lose viewers before the call to action',
};
