/**
 * Turns the Phase 1 findings into editing rules for Phase 2.
 * Only active findings with at least an early signal are used; each rule says where it came from.
 */
import { q } from '../db/pool.js';

export interface EditRule { code: string; value?: string; text: string; source: 'engine'; certainty: string; insight_id: string }

const WEAK = new Set(['not enough data', 'insufficient']);

export async function rulesFromEngine(origin: 'live' | 'demo' = 'live'): Promise<{ rules: EditRule[]; recommended_variant: string | null }> {
  const rows = await q<any>(
    `SELECT id, insight_type, title, metrics, certainty, confidence, recommended_action FROM ai_insights
      WHERE status='active' AND data_origin = ANY($1) ORDER BY coalesce(rank_score,0) DESC LIMIT 60`,
    [origin === 'demo' ? ['demo', 'mixed'] : ['live', 'mixed']]);
  const rules = new Map<string, EditRule>();
  let recommended: string | null = null;
  const add = (code: string, r: any, text: string, value?: string) => {
    if (!rules.has(code)) rules.set(code, { code, value, text, source: 'engine', certainty: r.certainty ?? r.confidence, insight_id: r.id });
  };
  for (const r of rows) {
    if (WEAK.has(String(r.certainty ?? r.confidence))) continue;
    const m = r.metrics ?? {};
    if (r.insight_type === 'driver') {
      const f = m.feature, v = String(m.better ?? '');
      if (f === 'product_shown_in_opening' && v === 'yes') add('product_in_opening', r, r.title);
      if (f === 'opening_has_narration' && v === 'yes') add('narration_in_opening', r, r.title);
      if (f === 'editing_pace' && v === 'fast') add('fast_pace', r, r.title);
      if (f === 'editing_pace' && v === 'slow') add('fewer_cuts', r, r.title);
      if (f === 'opening_style' && v === 'product_demo_first') add('product_in_opening', r, r.title);
      if (f === 'opening_style' && ['question', 'direct_statement', 'problem_first'].includes(v)) add('hook_text', r, r.title, v);
      if (f === 'cta_type' && v && v !== 'none') add('cta_type', r, r.title, v);
      if (f === 'edit_style' && v && v !== 'none' && !recommended) { recommended = v; add('edit_style', r, r.title, v); }
    } else if (r.insight_type === 'content_risk') {
      for (const x of m.by_moment_type ?? []) {
        const flagged = x.videos >= 4 && ((x.median_ratio ?? 0) >= 1.3 || ((x.median_ratio ?? 0) >= 1.15 && x.worse_in / x.videos >= 0.75));
        if (!flagged) continue;
        if (x.tag === 'long_explanation') add('split_long_explanations', r, r.title);
        if (x.tag === 'no_voice') add('cut_silences', r, r.title);
        if (x.tag === 'after_cut') add('fewer_cuts', r, r.title);
      }
    } else if (r.insight_type === 'cta_reach') {
      add('cta_early', r, r.title);
    } else if (r.insight_type === 'curve_pattern') {
      if (m.shape === 'hook_failure') { add('hook_text', r, r.title); add('narration_in_opening', r, r.title); }
      if (m.shape === 'mid_collapse') add('split_long_explanations', r, r.title);
      if (m.shape === 'ending_drop') add('cta_early', r, r.title);
      if (m.shape === 'slow_bleed') add('fast_pace', r, r.title);
    }
  }
  // fast pace and fewer cuts contradict each other: keep the one with stronger evidence (first seen = higher ranked)
  if (rules.has('fast_pace') && rules.has('fewer_cuts')) {
    const order = [...rules.keys()];
    rules.delete(order.indexOf('fast_pace') < order.indexOf('fewer_cuts') ? 'fewer_cuts' : 'fast_pace');
  }
  return { rules: [...rules.values()], recommended_variant: recommended };
}

export const RULE_PLAIN: Record<string, string> = {
  product_in_opening: 'Show the product in the first seconds',
  narration_in_opening: 'Start talking straight away',
  hook_text: 'Put a headline on screen during the first seconds',
  fast_pace: 'Change the shot at least every 4 seconds',
  fewer_cuts: 'Fewer cuts and zooms',
  split_long_explanations: 'Break long explanations into short caption groups',
  cut_silences: 'Cut pauses and silent stretches',
  cta_early: 'Ask for the follow before most viewers leave',
  cta_type: 'Use the call to action that works best',
  target_seconds: 'Keep the video to the length that works best',
  edit_style: 'Use the editing style that performs best',
};
