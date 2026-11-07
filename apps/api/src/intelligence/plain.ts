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
  if (r > 1.1 && r < 1.4) return `about a third more${n}`;
  if (r >= 1.4 && r < 1.75) return `about one and a half times as many${n}`;
  if (r >= 1.75 && r < 2.5) return `about twice as many${n}`;
  if (r >= 2.5) return `about ${Math.round(r)} times as many${n}`;
  if (r < 0.9 && r > 0.7) return `about a quarter fewer${n}`;
  if (r <= 0.7 && r > 0.4) return `about half as many${n}`;
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
  edit_style: { clean: 'use the clean cut with captions', branded: 'use the branded edit (logo, name card, end card)', motion: 'use the split-screen motion-graphics edit', overlay: 'use the full video with floating graphics', editorial: 'use the 3D Explainer style (full-screen 3D explainers between the speaker shots)', hype: 'use the Bold & Fast style', cinematic: 'use the Cinematic Story style', minimal: 'use the Clean & Minimal style' },
  ai_edited: { yes: 'are edited by the Content Studio', no: 'are edited by hand' },
  duration_bucket: { '0-15s': 'are under 15 seconds', '15-30s': 'are 15–30 seconds long', '30-60s': 'are 30–60 seconds long', '1-3min': 'are 1–3 minutes long', '3min+': 'are longer than 3 minutes' },
};
export function featurePlain(feature: string, value: string): string {
  const v = FEATURE_PLAIN[feature]?.[value];
  if (v) return v;
  if (feature === 'category') return `are "${value.replace(/_/g, ' ')}" videos`;
  if (feature === 'edit_style' && value.startsWith('ref_')) return `use the "${value.slice(4).replace(/_/g, ' ')}" style learned from a reference video`;
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

/** Two-sentence comparison of an outcome between two kinds of video. */
export function compareSentence(outcome: string, bestTxt: string, a: number, refTxt: string, b: number): string {
  switch (outcome) {
    case 'retention_3s': return `In videos that ${bestTxt}, ${inTen(a)} viewers stay past the first 3 seconds. In videos that ${refTxt}, ${inTen(b)} do.`;
    case 'retention_8s': return `In videos that ${bestTxt}, ${inTen(a)} viewers are still watching at 8 seconds. In videos that ${refTxt}, ${inTen(b)} are.`;
    case 'avg_view_ratio': return `In videos that ${bestTxt}, people watch ${fractionWords(a)} of the video on average. In videos that ${refTxt}, they watch ${fractionWords(b)}.`;
    case 'engagement_rate': return `In videos that ${bestTxt}, ${per1000(a)} in every 1,000 viewers like, comment, share or save. In videos that ${refTxt}, ${per1000(b)} do.`;
    case 'shares_saves_rate': return `In videos that ${bestTxt}, ${per1000(a)} in every 1,000 viewers share or save the video. In videos that ${refTxt}, ${per1000(b)} do.`;
    default: return `${OUTCOME_PLAIN[outcome]?.name ?? outcome}: ${a.toFixed(2)} vs ${b.toFixed(2)}.`;
  }
}
export function compareHeadline(outcome: string, bestTxt: string, a: number, b: number): string {
  switch (outcome) {
    case 'retention_3s': { const d = Math.max(1, Math.round((a - b) * 10)); return `Videos that ${bestTxt} keep ${d} more viewer${d === 1 ? '' : 's'} in 10 past the first 3 seconds`; }
    case 'avg_view_ratio': return `Videos that ${bestTxt} are watched for longer — ${fractionWords(a)} of the video on average, against ${fractionWords(b)}`;
    case 'engagement_rate': return `Videos that ${bestTxt} get ${ratioWords(a, b)} likes, comments, shares and saves`;
    case 'shares_saves_rate': return `Videos that ${bestTxt} get ${ratioWords(a, b)} shares and saves`;
    default: return `Videos that ${bestTxt} do better on ${OUTCOME_PLAIN[outcome]?.name ?? outcome}`;
  }
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
