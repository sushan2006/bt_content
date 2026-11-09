/**
 * Analysis engine v3: trend and popularity statistics, wording that never contradicts itself, the permutation test,
 * the whole analysis on the demo data (what it must find and what it must not claim), and the learnings for the next video.
 * No database needed: the demo data goes through the same row-building as the real data.
 */
import { describe, expect, it } from 'vitest';
import { fisherUpper, mannKendall, rng, theilSen } from '../src/intelligence/stats.js';
import { compareHeadline, compareSentence, twoValues } from '../src/intelligence/plain.js';
import { driversModel, DriverRow } from '../src/intelligence/models.js';
import { analyse, DEFAULT_ANALYSIS } from '../src/intelligence/engine.js';
import { buildLearnings, learningLine } from '../src/intelligence/learnings.js';
import { buildRows } from '../src/intelligence/dataset.js';
import { demoRows } from './helpers/demoRows.js';

describe('trend statistics', () => {
  it('Mann–Kendall sees a steady rise and ignores noise', () => {
    const up = mannKendall([1, 2, 2.5, 3, 4, 4.2, 5, 6, 6.5, 7]);
    expect(up.p).toBeLessThan(0.01); expect(up.tau).toBeGreaterThan(0.8);
    const r = rng(5), flat = mannKendall(Array.from({ length: 12 }, () => r()));
    expect(flat.p).toBeGreaterThan(0.05);
  });
  it('Theil–Sen is not pulled by one outlier', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7], y = x.map((v) => 2 * v + 1); y[7] = 100;
    expect(theilSen(x, y).slope).toBeCloseTo(2, 5);
  });
  it('Fisher exact upper tail matches the hypergeometric by hand', () => {
    // 4 breakouts out of 18 videos, a trait on 4 videos, 3 breakouts have it: (C(4,3)C(14,1) + C(4,4)) / C(18,4) = 57/3060
    expect(fisherUpper(3, 4, 4, 18)).toBeCloseTo(57 / 3060, 6);
  });
});

describe('wording never contradicts itself', () => {
  it('two values that round to the same words get finer words, or are flagged as the same', () => {
    const v = twoValues('avg_view_ratio', 0.41, 0.38);
    expect(v.a).not.toBe(v.b);
    expect(twoValues('avg_view_ratio', 0.401, 0.399).same).toBe(true);
    const s = twoValues('retention_3s', 0.24, 0.35);   // "2 in 10" vs "4 in 10" would exaggerate the ratio
    expect(s.a).toBe('24 in 100');
  });
  it('the headline difference matches the numbers in the sentence below it', () => {
    for (const [a, b] of [[0.78, 0.63], [0.72, 0.68], [0.55, 0.51], [0.45, 0.66]]) {
      const h = compareHeadline('retention_3s', 'open with a question', a, b, 'your other videos');
      const sen = compareSentence('retention_3s', 'open with a question', a, null, b);
      const [x, y] = [...sen.matchAll(/(\d+) in (10|100) viewers|, (\d+) in (10|100) do/g)].map((m) => Number(m[1] ?? m[3]));
      const d = Number(h.match(/keep (\d+)/)![1]) * (h.includes('fewer') ? -1 : 1);
      expect(d).toBe(x - y);
    }
  });
  it('a category reads naturally', () => {
    expect(compareHeadline('avg_view_ratio', 'are "company intro" videos', 0.4, 0.5, 'your other videos')).toMatch(/^"Company intro" videos are watched for less time/);
  });
});

function noiseRows(seed: number, effect: number): DriverRow[] {
  const r = rng(seed), rows: DriverRow[] = [];
  for (let v = 0; v < 18; v++) {
    const f = ['a', 'b', 'c'][Math.floor(r() * 3)];
    for (const platform of ['instagram', 'facebook']) rows.push({ cluster: `v${v}`, platform, y: (f === 'a' ? effect : 0) + (r() - 0.5) * 0.2, features: { f }, logDuration: Math.log(30), daysSinceStart: v * 5, isPaid: false });
  }
  return rows;
}
describe('permutation test', () => {
  it('finds a real effect', () => {
    const m = driversModel(noiseRows(1, 0.15), ['f'], { bootstrap: 100, permutations: 200 })!;
    expect(m.contrasts.find((c) => c.level === 'a')!.p_perm).toBeLessThan(0.02);
  });
  it('is calibrated on pure noise (about 1 in 20 below 0.05, not more)', () => {
    const ps: number[] = [];
    for (let s = 1; s <= 25; s++) ps.push(...driversModel(noiseRows(100 + s, 0), ['f'], { bootstrap: 20, permutations: 120 })!.contrasts.map((c) => c.p_perm));
    expect(ps.filter((p) => p <= 0.05).length / ps.length).toBeLessThan(0.12);
  });
});

describe('the whole analysis on the demo data', () => {
  const res = analyse(demoRows({ seed: 7 }), DEFAULT_ANALYSIS, 'Asia/Kolkata', 'demo');
  const drv = res.findings.filter((f) => f.insight_type === 'driver');
  it('finds the effects built into the demo', () => {
    expect(drv.some((f) => f.metrics.feature === 'opening_style' && f.metrics.level === 'slow_cinematic' && f.metrics.direction === 'avoid')).toBe(true);
    expect(drv.some((f) => f.metrics.feature === 'opening_style' && f.metrics.level === 'product_demo_first' && f.metrics.direction === 'do')).toBe(true);
    expect(res.findings.some((f) => f.insight_type === 'content_risk' && String(f.headline).includes('long explanations'))).toBe(true);
  });
  it('does not claim traits that have no effect in the demo as good evidence', () => {
    // call to action and publishing time are random in the demo data
    const claimed = drv.filter((f) => ['cta_type', 'publish_slot'].includes(String(f.metrics.feature)) && f.certainty !== 'early signal');
    expect(claimed.length).toBe(0);
    const brk = res.findings.find((f) => f.insight_type === 'breakout');
    if (brk && (brk.metrics as any).traits?.length) expect(brk.certainty).not.toBe('strong evidence');
  });
  it('never shows two equal-sounding values as a difference', () => {
    for (const f of res.findings) {
      const t = `${f.headline} ${f.story.what_happened}`;
      for (const m of t.matchAll(/watch ([a-z ]+?) of the video on [A-Za-z]+ and ([a-z ]+?) on/g)) expect(m[1]).not.toBe(m[2]);
      for (const m of t.matchAll(/In videos that [^,]+, ([^.]+?) viewers stay[^.]*\. In your other videos, ([^.]+?) do\./g)) expect(m[1]).not.toBe(m[2]);
    }
  });
  it('counts videos, not posts', () => {
    const risk = res.findings.find((f) => f.insight_type === 'content_risk')!;
    expect(Number(risk.story.what_happened.match(/in \d+ of (\d+) videos/)![1])).toBeLessThanOrEqual(18);
  });
  it('the brief lists each video at most once and gives a reason', () => {
    for (const list of [res.brief.wins, res.brief.problems]) {
      expect(new Set(list.map((w: any) => w.title)).size).toBe(list.length);
      for (const w of list) expect(w.text).toMatch(/usually/);
    }
    expect(res.brief.headline.length).toBeGreaterThan(20);
  });
  it('every finding that can guide the next video carries a learning line', () => {
    for (const f of res.findings.filter((x) => ['driver', 'curve_pattern', 'content_risk', 'cta_reach'].includes(x.insight_type)))
      expect((f.metrics as any).learning?.text?.length).toBeGreaterThan(10);
  });
  it('leaves out posts that are too new to judge', () => {
    const rows = demoRows({ seed: 7 }).map((r, i) => (i < 5 ? { ...r, derived: { ...r.derived, age_days: 0.5 } } : r));
    const out = analyse(rows, DEFAULT_ANALYSIS, 'Asia/Kolkata', 'demo');
    expect(out.rows.length).toBe(rows.length - 5);
    expect(out.brief.data_health.join(' ')).toMatch(/5 posts are less than 2 days old/);
  });
});

describe('Instagram skip rate', () => {
  it('becomes "stayed past 3 seconds" when there is no retention curve', () => {
    const [r] = buildRows({ pubs: [{ publication_id: 'p', content_item_id: 'c', title: 't', platform: 'instagram', format: 'reel', published_at: new Date().toISOString(), duration: 30, data_origin: 'live' }],
      metrics: [{ publication_id: 'p', metric_key: 'skip_rate', value: 42.5, availability: 'available' }], curves: [], feats: [], analyses: [] });
    expect(r.derived.retention_3s).toBeCloseTo(0.575, 6);
  });
});

describe('learnings for the next video', () => {
  const res = analyse(demoRows({ seed: 7 }), DEFAULT_ANALYSIS, 'Asia/Kolkata', 'demo');
  const ins = res.findings.map((f, i) => ({ id: `i${i}`, insight_type: f.insight_type, headline: f.headline, certainty: f.certainty, rank_score: f.rank_score, sample_size: f.sample_size, metrics: f.metrics }));
  const opts = { videos_analysed: 18, updated_at: '2026-11-09T00:00:00Z', style_counts: { kinetic_type: 5, simple_edit: 4 } };
  it('only uses findings with at least an early signal, at most 6, strongest first', () => {
    const L = buildLearnings(ins, { style: 'paper_cutout', platforms: ['instagram', 'facebook', 'youtube'] }, opts);
    expect(L.items.length).toBeGreaterThan(2); expect(L.items.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < L.items.length; i++) expect(L.items[i - 1].score).toBeGreaterThanOrEqual(L.items[i].score);
  });
  it('keeps platform advice to the platforms chosen', () => {
    const L = buildLearnings(ins, { style: 'paper_cutout', platforms: ['instagram'] }, opts);
    for (const i of L.items) if (i.platforms?.length) expect(i.platforms).toEqual(['instagram']);
  });
  it('tells you how the chosen style has done', () => {
    expect(buildLearnings(ins, { style: 'kinetic_type', platforms: [] }, opts).style!.verdict).toBe('good');
    expect(buildLearnings(ins, { style: 'pixel_art', platforms: [] }, opts).style!.verdict).toBe('untested');
  });
  it('the text for Claude holds only editing advice, with the reason and certainty', () => {
    const L = buildLearnings(ins, { style: 'paper_cutout', platforms: ['instagram', 'facebook', 'youtube'] }, opts);
    expect(L.prompt_text).toMatch(/^What our own analytics say works/);
    for (const i of L.items.filter((x) => !x.for_claude)) expect(L.prompt_text).not.toContain(i.text);
    for (const i of L.items.filter((x) => x.for_claude)) expect(learningLine(i)).toMatch(/Why: .+ \((strong evidence|good evidence|early signal), \d+ videos\)\.$/);
  });
  it('says why there is nothing yet', () => {
    expect(buildLearnings([], {}, { ...opts, videos_analysed: 0 }).empty_reason).toMatch(/No analysis yet/);
  });
});
