/** Small, dependency-free statistics toolkit used by the intelligence engine. */

export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a: number[], p: number) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export function percentileRank(a: number[], x: number) {
  if (!a.length) return NaN;
  return (a.filter((v) => v < x).length + 0.5 * a.filter((v) => v === x).length) / a.length;
}

/** Deterministic PRNG so the same data always yields the same confidence intervals. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Percentile bootstrap CI for mean(a) - mean(b). */
export function bootstrapDiffCI(a: number[], b: number[], iters = 2000, level = 0.95, seed = 42) {
  if (a.length < 2 || b.length < 2) return null;
  const r = rng(seed), diffs: number[] = [];
  const pick = (x: number[]) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[Math.floor(r() * x.length)]; return s / x.length; };
  for (let i = 0; i < iters; i++) diffs.push(pick(a) - pick(b));
  return { low: quantile(diffs, (1 - level) / 2), high: quantile(diffs, 1 - (1 - level) / 2) };
}

function normCdf(z: number) {
  // Abramowitz-Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Mann-Whitney U (two-sided). Exact permutation p-value when n1*n2 is small, else normal approximation
 * with tie correction. Robust for skewed social metrics and tiny samples.
 */
export function mannWhitney(a: number[], b: number[]) {
  const n1 = a.length, n2 = b.length;
  if (n1 < 1 || n2 < 1) return { u: NaN, p: 1 };
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1; tieSum += t ** 3 - t; i = j + 1;
  }
  const r1 = all.reduce((s, x, i) => (x.g === 0 ? s + ranks[i] : s), 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);
  if (n1 + n2 <= 14) return { u, p: exactPermutationP(a, b) };
  const mu = (n1 * n2) / 2, n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieSum / (n * (n - 1))));
  if (sigma === 0) return { u, p: 1 };
  const z = (Math.abs(u1 - mu) - 0.5) / sigma;
  return { u, p: Math.min(1, 2 * (1 - normCdf(z))) };
}

/** Exact two-sided permutation test on difference in means (all splits). */
function exactPermutationP(a: number[], b: number[]) {
  const all = [...a, ...b], n1 = a.length, n = all.length;
  const obs = Math.abs(mean(a) - mean(b));
  let count = 0, total = 0;
  const idx: number[] = [];
  const rec = (start: number) => {
    if (idx.length === n1) {
      const set = new Set(idx);
      const ga = idx.map((i) => all[i]), gb = all.filter((_, i) => !set.has(i));
      if (Math.abs(mean(ga) - mean(gb)) >= obs - 1e-12) count++;
      total++; return;
    }
    for (let i = start; i <= n - (n1 - idx.length); i++) { idx.push(i); rec(i + 1); idx.pop(); }
  };
  rec(0);
  return count / total;
}

/** Cliff's delta effect size in [-1,1]: P(a>b) - P(a<b). |d|<0.147 negligible, <0.33 small, <0.474 medium, else large. */
export function cliffsDelta(a: number[], b: number[]) {
  if (!a.length || !b.length) return NaN;
  let gt = 0, lt = 0;
  for (const x of a) for (const y of b) { if (x > y) gt++; else if (x < y) lt++; }
  return (gt - lt) / (a.length * b.length);
}
export const effectLabel = (d: number) => { const x = Math.abs(d); return x < 0.147 ? 'negligible' : x < 0.33 ? 'small' : x < 0.474 ? 'medium' : 'large'; };

export interface ConfidenceSettings { min_sample_preliminary: number; min_sample_moderate: number; min_sample_strong: number; alpha: number }

export type Confidence = 'insufficient' | 'preliminary' | 'moderate' | 'strong';

/**
 * Confidence is gated by sample size first, then by significance and effect size.
 * A pattern is never called reliable (moderate/strong) below the configured minimum sample.
 */
export function confidenceFor(nA: number, nB: number, p: number, delta: number, s: ConfidenceSettings): Confidence {
  const n = nA + nB;
  if (Math.min(nA, nB) < 2 || n < s.min_sample_preliminary) return 'insufficient';
  if (n >= s.min_sample_strong && Math.min(nA, nB) >= 5 && p < s.alpha / 5 && Math.abs(delta) >= 0.33) return 'strong';
  if (n >= s.min_sample_moderate && Math.min(nA, nB) >= 3 && p < s.alpha && Math.abs(delta) >= 0.147) return 'moderate';
  return 'preliminary';
}

/**
 * Mann–Kendall trend test: is there a steady rise or fall over time? Rank-based, so one viral video does not decide it.
 * Normal approximation with tie correction; `tau` is Kendall's tau in [-1, 1].
 */
export function mannKendall(y: number[]) {
  const n = y.length;
  if (n < 3) return { s: 0, z: 0, p: 1, tau: 0 };
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
  const counts = new Map<number, number>();
  for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
  let ties = 0;
  for (const t of counts.values()) if (t > 1) ties += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - ties) / 18;
  const z = varS <= 0 ? 0 : s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  return { s, z, p: Math.min(1, 2 * (1 - normCdf(Math.abs(z)))), tau: s / ((n * (n - 1)) / 2) };
}

/** Theil–Sen line: the median of all pairwise slopes (robust to outliers). */
export function theilSen(x: number[], y: number[]) {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
  const slope = slopes.length ? median(slopes) : 0;
  const intercept = median(y.map((v, i) => v - slope * x[i]));
  return { slope, intercept: Number.isFinite(intercept) ? intercept : 0 };
}

/**
 * One-sided Fisher exact test: probability of seeing at least `a` of the `k` breakout videos with a trait,
 * when `m` of all `n` videos have it (hypergeometric upper tail).
 */
export function fisherUpper(a: number, k: number, m: number, n: number) {
  const lc = (nn: number, kk: number) => { let s = 0; for (let i = 1; i <= kk; i++) s += Math.log(nn - kk + i) - Math.log(i); return s; };
  const denom = lc(n, k);
  let p = 0;
  for (let x = a; x <= Math.min(k, m); x++) {
    if (k - x > n - m) continue;
    p += Math.exp(lc(m, x) + lc(n - m, k - x) - denom);
  }
  return Math.min(1, p);
}
