import { describe, expect, it } from 'vitest';
import { benjaminiHochberg, driversModel, DriverRow, expectedModel, gradeFromZ, ridge, shrinkGroups } from '../src/intelligence/models.js';
import { diagnoseCurve, hookHoldDiagnosis } from '../src/intelligence/curve.js';
import { compareHeadline, fractionWords, inTen, ratioWords, videosNeeded } from '../src/intelligence/plain.js';
import { rng } from '../src/intelligence/stats.js';

const r = rng(3);
const noise = (s: number) => (r() - 0.5) * 2 * s;

describe('ridge regression', () => {
  it('recovers known coefficients', () => {
    const X: number[][] = [], y: number[] = [];
    for (let i = 0; i < 200; i++) { const a = r(), b = r(); X.push([a, b]); y.push(1 + 2 * a - 3 * b + noise(0.01)); }
    const m = ridge(X, y, 0.001);
    expect(m.beta[0]).toBeCloseTo(2, 1); expect(m.beta[1]).toBeCloseTo(-3, 1); expect(m.intercept).toBeCloseTo(1, 1);
  });
});

function makeRows(opts: { effect: number; confound?: boolean }): DriverRow[] {
  const rows: DriverRow[] = [];
  for (let v = 0; v < 24; v++) {
    const hasX = v % 2 === 0;
    for (const platform of ['instagram', 'facebook']) {
      const base = platform === 'instagram' ? 0.6 : 0.4;
      // confounded design: feature X appears mostly on the stronger platform but has NO real effect
      const feat = opts.confound ? (platform === 'instagram' ? (v % 4 !== 3 ? 'x' : 'y') : (v % 4 === 0 ? 'x' : 'y')) : hasX ? 'x' : 'y';
      rows.push({ cluster: `v${v}`, platform, y: base + (feat === 'x' ? opts.effect : 0) + noise(0.05), features: { f: feat, g: v % 3 === 0 ? 'a' : 'b' }, logDuration: Math.log(20 + (v % 5)), daysSinceStart: v * 5, isPaid: false });
    }
  }
  return rows;
}

describe('drivers model', () => {
  it('finds a real effect with high directional certainty', () => {
    const m = driversModel(makeRows({ effect: 0.1 }), ['f', 'g'], { bootstrap: 200 })!;
    const e = m.effects.find((x) => x.feature === 'f')!;
    const signed = e.level === 'x' ? e.effect_natural : -e.effect_natural;
    expect(signed).toBeGreaterThan(0.05);
    expect(e.prob_direction).toBeGreaterThan(0.95);
  });
  it('does not invent an effect for a feature that has none', () => {
    const m = driversModel(makeRows({ effect: 0.1 }), ['f', 'g'], { bootstrap: 200 })!;
    const g = m.effects.find((x) => x.feature === 'g')!;
    expect(Math.abs(g.effect_natural)).toBeLessThan(0.03);
  });
  it('controls for platform: a feature that only looks good because it sits on the stronger platform is not credited', () => {
    const m = driversModel(makeRows({ effect: 0, confound: true }), ['f'], { bootstrap: 200 })!;
    const e = m.effects.find((x) => x.feature === 'f')!;
    // naive comparison would show ~+0.1; within-platform model should be near zero
    expect(Math.abs(e.effect_natural)).toBeLessThan(0.04);
  });
  it('counts each original video once in the bootstrap (clusters)', () => {
    const m = driversModel(makeRows({ effect: 0.1 }), ['f'], { bootstrap: 50 })!;
    expect(m.clusters).toBe(24); expect(m.n).toBe(48);
  });
});

describe('partial pooling', () => {
  it('pulls small groups toward the overall mean more than large ones', () => {
    const big = Array.from({ length: 30 }, () => 0.7 + noise(0.05)), small = [0.95, 0.9], rest = Array.from({ length: 30 }, () => 0.5 + noise(0.05));
    const out = shrinkGroups([{ key: 'big', values: big }, { key: 'small', values: small }, { key: 'rest', values: rest }]);
    const s = out.find((x) => x.key === 'small')!, b = out.find((x) => x.key === 'big')!;
    expect(s.raw - s.shrunk).toBeGreaterThan(Math.abs(b.raw - b.shrunk));
  });
});

describe('false discovery rate', () => {
  it('Benjamini–Hochberg adjusts in order', () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeCloseTo(0.04); expect(q[2]).toBeCloseTo(0.0533, 3); expect(q[1]).toBeCloseTo(0.0533, 3); expect(q[3]).toBeCloseTo(0.5);
  });
});

describe('expected vs actual', () => {
  it('flags a video far above its platform peers', () => {
    const rows = [...Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, platform: 'facebook', y: 0.4 + noise(0.03), logDuration: null })), { id: 'star', platform: 'facebook', y: 0.7, logDuration: null }];
    const e = expectedModel(rows).get('star')!;
    expect(e.z).toBeGreaterThan(1);
    expect(gradeFromZ(e.z).grade).toBe('A');
  });
});

describe('curve diagnostics', () => {
  const mk = (f: (t: number) => number, dur = 30) => Array.from({ length: 41 }, (_, i) => ({ r: i / 40, t: (i / 40) * dur, v: f((i / 40) * dur) }));
  it('recognises a hook failure', () => {
    const d = diagnoseCurve(mk((t) => (t <= 3 ? 1 - 0.6 * (t / 3) : 0.4 * Math.exp(-0.02 * (t - 3)))), 30)!;
    expect(d.shape).toBe('hook_failure'); expect(d.hook_kept).toBeCloseTo(0.4, 1); expect(d.halfway_sec).toBeLessThan(3);
  });
  it('recognises a healthy curve', () => {
    const d = diagnoseCurve(mk((t) => Math.exp(-0.02 * t)), 30)!;
    expect(d.shape).toBe('healthy'); expect(d.halfway_sec).toBeNull();
  });
  it('recognises a mid-video collapse and names what was being said', () => {
    const d = diagnoseCurve(mk((t) => 0.95 * Math.exp(-0.01 * t) * (t > 15 ? 0.6 : 1)), 30, { transcript: [{ start: 14, end: 20, text: 'Long technical specification of the alloy' }] })!;
    expect(d.shape).toBe('mid_collapse');
    expect(d.moments.some((m) => m.what.includes('Long technical specification'))).toBe(true);
  });
  it('hook vs hold diagnosis', () => {
    expect(hookHoldDiagnosis(0.4, 0.1, 0.7, 0.1)).toMatch(/opening is the problem/);
    expect(hookHoldDiagnosis(0.75, 0.4, 0.7, 0.1)).toMatch(/Fix the middle/);
  });
});

describe('plain language', () => {
  it('uses natural frequencies and words, not percentiles', () => {
    expect(inTen(0.33)).toBe('3 in 10');
    expect(inTen(0.07)).toBe('about 1 in 14');
    expect(fractionWords(0.44)).toBe('about two fifths');
    expect(ratioWords(2, 1)).toBe('about twice as many');
    expect(ratioWords(0.5, 1)).toBe('about half as many');
    expect(compareHeadline('retention_3s', 'open with a question', 0.7, 0.5)).toBe('Videos that open with a question keep 2 more viewers in 10 past the first 3 seconds');
    expect(videosNeeded(1)).toBe(16);
    for (const s of [compareHeadline('avg_view_ratio', 'x', 0.5, 0.33), compareHeadline('engagement_rate', 'x', 0.03, 0.02)]) expect(s).not.toMatch(/percentile|p=|z-score|\d+\.\d{2,}/);
  });
});
