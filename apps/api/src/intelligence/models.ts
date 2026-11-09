/**
 * Statistical models for engine v2 (dependency-free, deterministic).
 *
 *  ridge()              penalised linear regression (stable with few videos and correlated features)
 *  driversModel()       outcome ~ content features + controls (platform, length, publish date, paid),
 *                       outcome standardised within platform so platforms can be pooled,
 *                       uncertainty by CLUSTER bootstrap over original videos (a video on 3 platforms counts once)
 *  shrinkGroups()       empirical-Bayes partial pooling of group averages (small groups pulled toward the overall mean)
 *  expectedModel()      leave-one-out expected value per video from platform + length → "better/worse than expected"
 *  benjaminiHochberg()  false-discovery-rate control across all findings of a run
 */
import { mean, median, rng, std } from './stats.js';

/* ---------------- linear algebra ---------------- */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r) => r[n]);
}

/** Ridge with unpenalised intercept. X rows = observations. Returns {intercept, beta}. */
export function ridge(X: number[][], y: number[], lambda: number, weights?: number[]) {
  const n = X.length, p = X[0]?.length ?? 0;
  const w = weights ?? new Array(n).fill(1);
  const sw = w.reduce((a, b) => a + b, 0);
  const mx = Array.from({ length: p }, (_, j) => X.reduce((s, r, i) => s + w[i] * r[j], 0) / sw);
  const my = y.reduce((s, v, i) => s + w[i] * v, 0) / sw;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      const xj = X[i][j] - mx[j];
      b[j] += w[i] * xj * (y[i] - my);
      for (let k = j; k < p; k++) A[j][k] += w[i] * xj * (X[i][k] - mx[k]);
    }
  }
  for (let j = 0; j < p; j++) { for (let k = 0; k < j; k++) A[j][k] = A[k][j]; A[j][j] += lambda; }
  const beta = p ? solve(A, b) : [];
  const intercept = my - beta.reduce((s, bj, j) => s + bj * mx[j], 0);
  return { intercept, beta };
}
export const predict = (m: { intercept: number; beta: number[] }, x: number[]) => m.intercept + m.beta.reduce((s, b, j) => s + b * x[j], 0);

/** Choose lambda by leave-one-cluster-out cross-validation error. */
function chooseLambda(X: number[][], y: number[], clusters: string[], grid = [0.3, 1, 3, 10]) {
  const ids = [...new Set(clusters)];
  if (ids.length < 6) return 3;
  let best = grid[0], bestErr = Infinity;
  for (const l of grid) {
    let err = 0;
    for (const id of ids) {
      const tr = clusters.map((c, i) => (c !== id ? i : -1)).filter((i) => i >= 0);
      const te = clusters.map((c, i) => (c === id ? i : -1)).filter((i) => i >= 0);
      const m = ridge(tr.map((i) => X[i]), tr.map((i) => y[i]), l);
      for (const i of te) err += (predict(m, X[i]) - y[i]) ** 2;
    }
    if (err < bestErr) { bestErr = err; best = l; }
  }
  return best;
}

/* ---------------- drivers model ---------------- */
export interface DriverRow {
  cluster: string;                    // original content item (videos on several platforms share it)
  platform: string;
  y: number;                          // outcome in natural units
  features: Record<string, string | null | undefined>;
  logDuration: number | null;
  daysSinceStart: number | null;
  isPaid: boolean | null;
}
export interface DriverEffect {
  feature: string; level: string; reference: string;
  effect_z: number;                   // in within-platform standard deviations
  effect_natural: number;             // in outcome units, using the median within-platform SD
  low: number; high: number;          // 90% interval, natural units
  prob_direction: number;             // share of bootstrap fits agreeing on the sign
  n_level: number; n_reference: number;
  overlaps_with: string[];            // other features this level is almost always paired with
}
/** One tag level compared with all other videos that have a known value for the same feature (what a manager means by "the rest"). */
export interface DriverContrast {
  feature: string; level: string;
  effect_z: number; effect_natural: number; low: number; high: number; prob_direction: number;
  n_level: number; n_rest: number;
  overlaps_with: string[];
  p_perm: number;                     // permutation p-value: share of label shuffles (whole videos) giving a contrast at least this large
}

export function driversModel(rows: DriverRow[], featureKeys: string[], opts: { bootstrap?: number; permutations?: number; seed?: number } = {}) {
  // Standardise outcome within platform
  const byP = new Map<string, number[]>();
  for (const r of rows) byP.set(r.platform, [...(byP.get(r.platform) ?? []), r.y]);
  const pStats = new Map([...byP].map(([p, v]) => [p, { m: mean(v), s: std(v) || 1 }]));
  const usable = rows.filter((r) => (byP.get(r.platform)?.length ?? 0) >= 3);
  if (usable.length < 6) return null;
  const sdNatural = median([...pStats].filter(([p]) => (byP.get(p)?.length ?? 0) >= 3).map(([, s]) => s.s));

  // Encode: reference level = most common level of each feature; levels with < 2 videos are folded into "other"
  const encoding: { feature: string; level: string; reference: string }[] = [];
  for (const f of featureKeys) {
    const counts = new Map<string, number>();
    for (const r of usable) { const v = r.features[f]; if (v != null && v !== 'unknown') counts.set(v, (counts.get(v) ?? 0) + 1); }
    const levels = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    if (levels.length < 2) continue;
    const ref = levels[0][0];
    for (const [lv] of levels.slice(1)) encoding.push({ feature: f, level: lv, reference: ref });
  }
  if (!encoding.length) return null;
  const platforms = [...new Set(usable.map((r) => r.platform))].sort();
  const durs = usable.map((r) => r.logDuration).filter((x): x is number => x != null), mDur = durs.length ? mean(durs) : 0;
  const days = usable.map((r) => r.daysSinceStart).filter((x): x is number => x != null), mDays = days.length ? mean(days) : 0, sDays = std(days) || 1;
  const encode = (r: DriverRow) => [
    ...encoding.map((e) => (r.features[e.feature] === e.level ? 1 : 0)),
    ...platforms.slice(1).map((p) => (r.platform === p ? 1 : 0)),
    r.logDuration == null ? 0 : r.logDuration - mDur,
    r.daysSinceStart == null ? 0 : (r.daysSinceStart - mDays) / sDays,
    r.isPaid ? 1 : 0,
  ];
  const X = usable.map(encode);
  const z = usable.map((r) => (r.y - pStats.get(r.platform)!.m) / pStats.get(r.platform)!.s);
  const clusters = usable.map((r) => r.cluster);
  const lambda = chooseLambda(X, z, clusters);
  const fit = ridge(X, z, lambda);

  // Cluster bootstrap
  const B = opts.bootstrap ?? 400, rand = rng(opts.seed ?? 11);
  const ids = [...new Set(clusters)];
  const idxBy = new Map(ids.map((id) => [id, clusters.map((c, i) => (c === id ? i : -1)).filter((i) => i >= 0)]));
  const draws: number[][] = encoding.map(() => []);
  for (let b = 0; b < B; b++) {
    const pick: number[] = [];
    for (let k = 0; k < ids.length; k++) pick.push(...idxBy.get(ids[Math.floor(rand() * ids.length)])!);
    const m = ridge(pick.map((i) => X[i]), pick.map((i) => z[i]), lambda);
    encoding.forEach((_, j) => draws[j].push(m.beta[j]));
  }
  // In-sample fit quality (share of variation explained)
  const pred = X.map((x) => predict(fit, x));
  const ssr = z.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0), sst = z.reduce((s, v) => s + (v - mean(z)) ** 2, 0) || 1;

  const overlapsOf = (feature: string, level: string) => {
    const lvRows = usable.filter((r) => r.features[feature] === level);
    const overlaps: string[] = [];
    for (const other of featureKeys) {
      if (other === feature) continue;
      const vals = lvRows.map((r) => r.features[other]).filter((v) => v != null && v !== 'unknown') as string[];
      if (vals.length < 2) continue;
      const counts = new Map<string, number>(); vals.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
      const [topV, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
      const base = usable.filter((r) => r.features[other] === topV).length / usable.length;
      if (n / vals.length >= 0.85 && base < 0.6) overlaps.push(`${other}=${topV}`);
    }
    return overlaps;
  };
  const q05 = (d: number[]) => d[Math.floor(0.05 * (d.length - 1))], q95 = (d: number[]) => d[Math.ceil(0.95 * (d.length - 1))];
  const effects: DriverEffect[] = encoding.map((e, j) => {
    const d = [...draws[j]].sort((a, b) => a - b), beta = fit.beta[j];
    const agree = d.filter((x) => Math.sign(x) === Math.sign(beta) && x !== 0).length / d.length;
    return {
      ...e, effect_z: beta, effect_natural: beta * sdNatural, low: q05(d) * sdNatural, high: q95(d) * sdNatural,
      prob_direction: agree, n_level: usable.filter((r) => r.features[e.feature] === e.level).length,
      n_reference: usable.filter((r) => r.features[e.feature] === e.reference).length, overlaps_with: overlapsOf(e.feature, e.level),
    };
  });

  // Each level against the rest: beta(level) − count-weighted mean of the other levels' betas (reference = 0), same for every bootstrap fit.
  const contrastFn = (f: string, data: DriverRow[]) => {
    const cols = encoding.map((e, j) => ({ e, j })).filter((x) => x.e.feature === f);
    const levels = [{ level: cols[0].e.reference, j: -1 }, ...cols.map((c) => ({ level: c.e.level, j: c.j }))]
      .map((l) => ({ ...l, n: data.filter((r) => r.features[f] === l.level).length }));
    return { levels, of: (L: typeof levels[number], beta: (j: number) => number) => {
      const rest = levels.filter((x) => x !== L), nRest = rest.reduce((s2, x) => s2 + x.n, 0);
      return nRest ? beta(L.j) - rest.reduce((s2, x) => s2 + x.n * beta(x.j), 0) / nRest : 0;
    } };
  };
  // Permutation test (small-sample safe): shuffle one tag's values between whole videos, refit, and count how often chance
  // alone gives a contrast at least as large. Keeps each video's posts together and every other tag as it was.
  const P = opts.permutations ?? 300, prand = rng((opts.seed ?? 11) + 1);
  const clusterIds = [...new Set(clusters)];
  const contrasts: DriverContrast[] = [];
  for (const f of [...new Set(encoding.map((e) => e.feature))]) {
    const cf = contrastFn(f, usable);
    const betaOf = (j: number, b?: number) => (j < 0 ? 0 : b === undefined ? fit.beta[j] : draws[j][b]);
    const obs = cf.levels.map((L) => (L.n >= 2 ? cf.of(L, (j) => betaOf(j)) : 0));
    const exceed = cf.levels.map(() => 0);
    // the tag value of each video (its first post's value; tags are per video)
    const valueOf = new Map(clusterIds.map((id) => [id, usable[clusters.indexOf(id)].features[f] ?? null]));
    for (let k = 0; k < P; k++) {
      const vals = [...valueOf.values()];
      for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(prand() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
      const perm = new Map(clusterIds.map((id, i) => [id, vals[i]]));
      const data = usable.map((r) => ({ ...r, features: { ...r.features, [f]: perm.get(r.cluster) } }));
      const m = ridge(data.map(encode), z, lambda);
      const pc = contrastFn(f, data);
      pc.levels.forEach((L, i) => { if (Math.abs(pc.of(L, (j) => (j < 0 ? 0 : m.beta[j]))) >= Math.abs(obs[i]) - 1e-12) exceed[i]++; });
    }
    cf.levels.forEach((L, i) => {
      const rest = cf.levels.filter((x) => x !== L), nRest = rest.reduce((s2, x) => s2 + x.n, 0);
      if (!nRest || L.n < 2) return;
      const c = obs[i], d = Array.from({ length: B }, (_, b) => cf.of(L, (j) => betaOf(j, b))).sort((a, b2) => a - b2);
      contrasts.push({
        feature: f, level: L.level, effect_z: c, effect_natural: c * sdNatural, low: q05(d) * sdNatural, high: q95(d) * sdNatural,
        prob_direction: d.filter((x) => Math.sign(x) === Math.sign(c) && x !== 0).length / d.length, n_level: L.n, n_rest: nRest,
        overlaps_with: overlapsOf(f, L.level), p_perm: (1 + exceed[i]) / (1 + P),
      });
    });
  }
  return { effects, contrasts, n: usable.length, clusters: ids.length, lambda, r2: 1 - ssr / sst, sdNatural, platforms };
}

/* ---------------- partial pooling of group averages ---------------- */
export function shrinkGroups(groups: { key: string; values: number[] }[]) {
  const all = groups.flatMap((g) => g.values);
  if (all.length < 3) return groups.map((g) => ({ key: g.key, n: g.values.length, raw: mean(g.values), shrunk: mean(g.values), weight: 1 }));
  const grand = mean(all);
  const within = mean(groups.filter((g) => g.values.length > 1).map((g) => std(g.values) ** 2).filter(Number.isFinite)) || std(all) ** 2 || 1e-6;
  const means = groups.map((g) => mean(g.values));
  const between = Math.max(0, (std(means) ** 2 || 0) - mean(groups.map((g) => within / g.values.length)));
  return groups.map((g) => {
    const se2 = within / g.values.length;
    const B = between > 0 ? se2 / (se2 + between) : 1;      // shrinkage factor: 1 = fully pooled
    return { key: g.key, n: g.values.length, raw: mean(g.values), shrunk: grand + (1 - B) * (mean(g.values) - grand), weight: 1 - B };
  });
}

/* ---------------- expected value per video ---------------- */
/** For each row, leave-one-out expectation from same-platform videos of similar length. */
export function expectedModel(rows: { id: string; platform: string; y: number; logDuration: number | null }[]) {
  const out = new Map<string, { expected: number; sd: number; z: number; peers: number }>();
  for (const r of rows) {
    const peers = rows.filter((p) => p.platform === r.platform && p.id !== r.id);
    if (peers.length < 3) continue;
    const ys = peers.map((p) => p.y);
    let expected = median(ys);
    const withDur = peers.filter((p) => p.logDuration != null);
    if (r.logDuration != null && withDur.length >= 5) {
      const m = ridge(withDur.map((p) => [p.logDuration!]), withDur.map((p) => p.y), 1);
      expected = predict(m, [r.logDuration]);
    }
    const resid = peers.map((p) => p.y - median(ys));
    const sd = std(resid) || std(ys) || 1e-6;
    out.set(r.id, { expected, sd, z: (r.y - expected) / sd, peers: peers.length });
  }
  return out;
}

export function gradeFromZ(z: number) {
  if (z >= 1) return { grade: 'A', words: 'well above what we would expect' };
  if (z >= 0.35) return { grade: 'B', words: 'better than expected' };
  if (z > -0.35) return { grade: 'C', words: 'about as expected' };
  if (z > -1) return { grade: 'D', words: 'below expectations' };
  return { grade: 'E', words: 'well below expectations' };
}

/* ---------------- false discovery rate ---------------- */
/** Returns q-values (BH-adjusted p-values) in the same order. */
export function benjaminiHochberg(p: number[]) {
  const n = p.length, order = p.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = new Array(n).fill(1);
  let prev = 1;
  for (let k = n - 1; k >= 0; k--) {
    const [v, i] = order[k];
    prev = Math.min(prev, (v * n) / (k + 1));
    q[i] = Math.min(1, prev);
  }
  return q;
}
