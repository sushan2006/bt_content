/**
 * Learnings for the next video: the strongest lessons from past videos, chosen for the style and platforms of the video being set up.
 * Pure (no database): the engine writes a ready-made `learning` line into each finding; this picks, merges and orders them.
 * Used by the New video page (copy box) and by the edit prompt, so both always say the same thing.
 */
import type { Learning } from './engine.js';
import { PLATFORM } from './plain.js';

export interface InsightLite { id: string; insight_type: string; headline: string; certainty: string; rank_score: number | null; sample_size: number | null; metrics: any }
export interface NextVideoContext { style?: string | null; style_name?: string | null; platforms?: string[] | null }
export interface LearningItem extends Learning { certainty: string; videos: number; insight_id: string; headline: string; score: number }
export interface Learnings {
  items: LearningItem[];
  style: { key: string; name: string; videos: number; verdict: 'good' | 'weak' | 'untested' | 'neutral'; text: string } | null;
  prompt_text: string | null;
  videos_analysed: number; updated_at: string | null; empty_reason: string | null;
}

const CERT_W: Record<string, number> = { 'strong evidence': 1, 'good evidence': 0.8, 'early signal': 0.55 };
const MAX_ITEMS = 6;
const platformsTxt = (ps?: string[]) => (ps?.length ? ps.map((p) => PLATFORM[p] ?? p).join(' and ') : '');

/** One line for a prompt: "Instagram: Put a short call to action … — only 2 in 10 … (good evidence, 18 videos)". */
export function learningLine(i: LearningItem, withPlatforms = true) {
  const names = (i.platforms ?? []).map((p) => PLATFORM[p] ?? p);
  const where = withPlatforms && names.length && !names.some((n) => i.text.includes(n)) ? `${platformsTxt(i.platforms)}: ` : '';
  return `${where}${i.text.replace(/\.$/, '')}. Why: ${i.why} (${i.certainty}, ${i.videos} videos).`;
}

export function buildLearnings(insights: InsightLite[], ctx: NextVideoContext, opts: { videos_analysed: number; updated_at: string | null; style_counts: Record<string, number> }): Learnings {
  const wanted = new Set(ctx.platforms ?? []);
  let styleVerdict: { verdict: 'good' | 'weak'; why: string; certainty: string; videos: number } | null = null;
  const pool: LearningItem[] = [];
  for (const ins of insights) {
    const L: Learning | undefined = ins.metrics?.learning;
    const w = CERT_W[ins.certainty];
    if (!L || !w) continue;                                   // "not enough data" never becomes advice
    if (L.platforms?.length && wanted.size && !L.platforms.some((p) => wanted.has(p))) continue;
    if (L.style) {
      if (L.style === ctx.style) { if (!styleVerdict) styleVerdict = { verdict: L.kind === 'do' ? 'good' : 'weak', why: L.why, certainty: ins.certainty, videos: ins.sample_size ?? 0 }; continue; }
      if (L.kind === 'avoid') continue;                       // a warning about a style you did not pick is noise here
    }
    const platforms = L.platforms?.filter((p) => !wanted.size || wanted.has(p));
    pool.push({ ...L, platforms, certainty: ins.certainty, videos: ins.sample_size ?? 0, insight_id: ins.id, headline: ins.headline, score: (ins.rank_score ?? 0) * w });
  }
  pool.sort((a, b) => b.score - a.score);
  const items: LearningItem[] = [];
  for (const it of pool) {
    // the same fix found on several platforms → one line naming them
    const same = items.find((x) => x.text === it.text);
    if (same) { same.platforms = [...new Set([...(same.platforms ?? []), ...(it.platforms ?? [])])]; continue; }
    // one lesson per tag value (pattern + breakouts can find the same one), and never two different "do" values of one tag
    // (fast pace and medium pace): keep the stronger. "Do A" and "avoid B" for the same tag agree, so both stay.
    const feature = it.topic.split('=')[0];
    const clash = items.some((x) => x.topic === it.topic || (it.topic.includes('=') && x.topic.split('=')[0] === feature && x.kind === 'do' && it.kind === 'do'));
    if (clash) continue;
    items.push({ ...it });
  }
  const top = items.slice(0, MAX_ITEMS);

  let style: Learnings['style'] = null;
  if (ctx.style) {
    const videos = opts.style_counts[ctx.style] ?? 0, name = ctx.style_name ?? ctx.style;
    style = styleVerdict
      ? { key: ctx.style, name, videos, verdict: styleVerdict.verdict, text: styleVerdict.verdict === 'good'
          ? `Good choice: in your results, ${styleVerdict.why} (${styleVerdict.certainty}, ${styleVerdict.videos} videos).`
          : `Careful: in your results, ${styleVerdict.why} (${styleVerdict.certainty}, ${styleVerdict.videos} videos). Make the opening and the pace extra strong, or pick another style.` }
      : videos < 3
        ? { key: ctx.style, name, videos, verdict: 'untested', text: `Not measured yet: ${videos ? `only ${videos} published video${videos === 1 ? '' : 's'}` : 'no published videos'} in this style. Its results are compared with your other styles from about 3 videos.` }
        : { key: ctx.style, name, videos, verdict: 'neutral', text: `No clear difference yet between this style and your others (${videos} published videos in it).` };
  }

  const forClaude = top.filter((i) => i.for_claude);
  const dos = forClaude.filter((i) => i.kind === 'do'), avoids = forClaude.filter((i) => i.kind === 'avoid');
  const date = opts.updated_at ? new Date(opts.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const prompt_text = forClaude.length ? [
    'What our own analytics say works — apply it where it fits this video',
    `(learned from ${opts.videos_analysed} of our published videos${date ? `; analysis of ${date}` : ''}; strongest first)`,
    '',
    ...(dos.length ? ['Do:', ...dos.map((i, k) => `${k + 1}. ${learningLine(i)}`)] : []),
    ...(avoids.length ? [...(dos.length ? [''] : []), 'Avoid:', ...avoids.map((i) => `- ${learningLine(i)}`)] : []),
    '',
    'Early signals are worth testing, not rules: follow these unless they clash with the brief, and tell me where you could not.',
  ].join('\n') : null;

  const empty_reason = top.length ? null : !insights.length
    ? 'No analysis yet. Once published videos have results, run the analysis (Overview › Update analysis) and the lessons appear here.'
    : 'No pattern is clear enough yet. With about 8 published videos that have results, the strongest patterns show here.';
  return { items: top, style, prompt_text, videos_analysed: opts.videos_analysed, updated_at: opts.updated_at, empty_reason };
}
