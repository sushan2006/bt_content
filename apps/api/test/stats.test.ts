import { describe, expect, it } from 'vitest';
import { bootstrapDiffCI, cliffsDelta, confidenceFor, mannWhitney, median, percentileRank } from '../src/intelligence/stats.js';
import { dropOffPoints, normaliseCurve, resolveSegments, retentionAt, segmentRetention } from '../src/intelligence/segments.js';
import { parseFbRetention } from '../src/integrations/facebook.js';
import { parseIsoDuration } from '../src/integrations/youtube.js';

const cfg = { min_sample_preliminary: 4, min_sample_moderate: 8, min_sample_strong: 15, alpha: 0.05 };

describe('statistics', () => {
  it('median / percentile', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(percentileRank([1, 2, 3, 4], 3)).toBeCloseTo(0.625);
  });
  it('Mann-Whitney exact p for fully separated 4 vs 4 is 2/70', () => {
    const { p } = mannWhitney([10, 11, 12, 13], [1, 2, 3, 4]);
    expect(p).toBeCloseTo(2 / 70, 5);
  });
  it('Mann-Whitney identical samples p=1', () => {
    expect(mannWhitney([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]).p).toBeGreaterThan(0.9);
  });
  it('Cliffs delta', () => {
    expect(cliffsDelta([5, 6], [1, 2])).toBe(1);
    expect(cliffsDelta([1, 2], [1, 2])).toBe(0);
  });
  it('bootstrap CI contains the true difference and is deterministic', () => {
    const a = [10, 11, 12, 13, 14], b = [5, 6, 7, 8, 9];
    const ci = bootstrapDiffCI(a, b)!;
    expect(ci.low).toBeLessThan(5); expect(ci.high).toBeGreaterThan(5);
    expect(bootstrapDiffCI(a, b)).toEqual(ci);
  });
  it('confidence gating: 4 videos can never be more than preliminary', () => {
    expect(confidenceFor(2, 2, 0.0001, 1, cfg)).toBe('preliminary');
    expect(confidenceFor(1, 5, 0.0001, 1, cfg)).toBe('insufficient');
    expect(confidenceFor(5, 5, 0.01, 0.6, cfg)).toBe('moderate');
    expect(confidenceFor(8, 8, 0.001, 0.6, cfg)).toBe('strong');
    expect(confidenceFor(8, 8, 0.3, 0.6, cfg)).toBe('preliminary');
  });
});

describe('segments', () => {
  const tpl = [
    { code: 'opening', label: 'Opening', start: 0, end: 3 }, { code: 'hook', label: 'Hook', start: 3, end: 8 },
    { code: 'main', label: 'Main', start: 8, end: 20 }, { code: 'demo', label: 'Demo', start: 20, end: 40 },
    { code: 'ending', label: 'Ending', start: '-15%', end: '100%' },
  ];
  it('60s video: ending anchored to last 15%, previous segment stretched to meet it', () => {
    const s = resolveSegments(tpl, 60);
    expect(s.map((x) => x.code)).toEqual(['opening', 'hook', 'main', 'demo', 'ending']);
    expect(s.at(-1)).toMatchObject({ start: 51, end: 60 });
    expect(s.at(-2)!.end).toBe(51);
  });
  it('12s video: drops segments that do not fit, ending at least 3s', () => {
    const s = resolveSegments(tpl, 12);
    expect(s.map((x) => x.code)).toEqual(['opening', 'hook', 'ending']);
    expect(s.at(-1)).toMatchObject({ start: 9, end: 12 });
    expect(s[1].end).toBe(9);
  });
  it('segments never overlap and cover the video', () => {
    for (const d of [5, 9, 15, 33, 61, 300]) {
      const s = resolveSegments(tpl, d);
      for (let i = 1; i < s.length; i++) expect(s[i].start).toBeCloseTo(s[i - 1].end, 5);
      expect(s[0].start).toBe(0); expect(s.at(-1)!.end).toBe(d);
    }
  });
  it('retention interpolation, normalisation and segment drop', () => {
    const pts = [{ r: 0, t: 0, v: 1.2 }, { r: 0.1, t: 3, v: 0.6 }, { r: 1, t: 30, v: 0.3 }];
    const n = normaliseCurve(pts);
    expect(n[0].v).toBe(1);
    expect(retentionAt(n, 3, 30)).toBeCloseTo(0.5);
    const seg = segmentRetention(pts, [{ code: 'opening', label: 'O', start: 0, end: 3 }], 30)[0];
    expect(seg.drop).toBeCloseTo(0.5); expect(seg.relative_drop).toBeCloseTo(0.5);
  });
  it('detects a sharp drop-off', () => {
    const pts = Array.from({ length: 41 }, (_, i) => ({ r: i / 40, t: null, v: i < 20 ? 1 - i * 0.005 : i === 20 ? 0.6 : 0.6 - (i - 20) * 0.005 }));
    const d = dropOffPoints(pts, 40);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].at_sec).toBeCloseTo(19.5, 1);
  });
});

describe('platform parsing', () => {
  it('Facebook retention graph', () => {
    const p = parseFbRetention({ '0': 1, '20': 0.5, '40': 0.1 });
    expect(p).toEqual([{ r: 0, v: 1 }, { r: 0.5, v: 0.5 }, { r: 1, v: 0.1 }]);
    expect(parseFbRetention({ '0': 100, '1': 50 })[1].v).toBe(0.5);
  });
  it('ISO 8601 durations', () => {
    expect(parseIsoDuration('PT1M5S')).toBe(65);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
  });
});
