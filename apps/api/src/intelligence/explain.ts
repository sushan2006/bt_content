import { one, q } from '../db/pool.js';
import { loadDataset } from './dataset.js';
import { median, percentileRank } from './stats.js';
import { videoDiagnostics } from './engine.js';
import { hookHoldDiagnosis, SHAPE_PLAIN } from './curve.js';
import { clock, featurePlain, inTen, OUTCOME_PLAIN, per1000, PLATFORM, rankWords, ratioWords, shortValue } from './plain.js';

/**
 * Video report card in plain language, for a content head or CEO:
 * verdict, grade, what happened (in "x in 10 viewers" terms), the moments people left and what was on screen,
 * strengths, what to change next time (from the drivers the engine found), and the same video on other platforms.
 * The statistics stay available under `technical`.
 */
export async function explainPublication(publicationId: string) {
  const origin = (await one<any>(`SELECT sa.data_origin FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id WHERE p.id=$1`, [publicationId]))?.data_origin ?? 'live';
  const rows = await loadDataset(origin);
  const me = rows.find((r) => r.publication_id === publicationId);
  if (!me) return null;
  const diags = videoDiagnostics(rows);
  const d = diags.find((x) => x.publication_id === publicationId)!;
  const peers = rows.filter((r) => r.platform === me.platform && r.publication_id !== me.publication_id);
  const peerDiags = diags.filter((x) => x.platform === me.platform && x.publication_id !== publicationId && x.curve);
  const P = PLATFORM[me.platform] ?? me.platform;
  const med = (k: string) => { const v = peers.map((p) => p.derived[k]).filter((x): x is number => x != null); return v.length >= 2 ? median(v) : null; };

  // ---- what happened, in plain words
  const story: string[] = [];
  const c = d.curve;
  const cohortHook = peerDiags.length >= 2 ? median(peerDiags.map((x) => x.curve!.hook_kept)) : null;
  const cohortLoss = peerDiags.length >= 2 ? median(peerDiags.map((x) => x.curve!.loss_per_10s).filter((x): x is number => x != null)) : null;
  const cohortHalf = peerDiags.length >= 2 ? median(peerDiags.map((x) => x.curve!.halfway_sec ?? x.curve!.duration)) : null;
  const cohortEnd = peerDiags.length >= 2 ? median(peerDiags.map((x) => x.curve!.completion)) : null;
  if (c) {
    story.push(`Out of every 10 people who started watching, ${Math.round(c.hook_kept * 10)} were still there after ${c.hook_at_sec} seconds${cohortHook != null ? ` — similar ${P} videos usually keep ${Math.round(cohortHook * 10)}` : ''}.`);
    story.push(c.halfway_sec != null ? `Half the audience had left by ${clock(c.halfway_sec)}${cohortHalf != null ? ` (usually around ${clock(cohortHalf)})` : ''}.` : 'More than half the audience was still watching at the end.');
    story.push(`${cap(inTen(c.completion))} watched to the end${cohortEnd != null ? ` (usually ${inTen(cohortEnd)})` : ''}.`);
  } else if (me.derived.avg_view_ratio != null) {
    const m = med('avg_view_ratio');
    story.push(`People watched about ${Math.round(me.derived.avg_view_ratio * 100)}% of the video on average${m != null ? ` (usually ${Math.round(m * 100)}% for ${P})` : ''}. ${me.platform === 'instagram' ? 'Instagram does not share second-by-second viewer data, so we cannot see exactly when they left.' : ''}`.trim());
  }
  if (me.derived.engagement_rate != null) {
    const m = med('engagement_rate'), v = me.derived.engagement_rate;
    story.push(`${cap(per1000(v))} in every 1,000 viewers liked, commented, shared or saved it${m != null ? ` — ${ratioWords(v, m)} as a typical ${P} video` : ''}.`);
  }
  if (me.derived.shares_saves_rate != null && (me.metrics.shares != null || me.metrics.saves != null)) {
    const m = med('shares_saves_rate'), v = me.derived.shares_saves_rate;
    story.push(`${cap(per1000(v))} in every 1,000 viewers shared or saved it${m != null && m > 0 ? ` — ${ratioWords(v, m)} as a typical ${P} video` : ''}.`);
  }

  // ---- verdict
  const avr = me.derived.avg_view_ratio, rankList = peers.map((p) => p.derived.avg_view_ratio).filter((x): x is number => x != null);
  const rank = avr != null ? [...rankList, avr].sort((a, b) => b - a).indexOf(avr) + 1 : null;
  const verdict = c && c.shape !== 'healthy'
    ? `${SHAPE_PLAIN[c.shape].meaning.replace(/^Most viewers/, 'Most viewers of this video').replace(/^The opening works/, 'The opening works')}`
    : d.grade_words ? `This video performed ${d.grade_words} for a ${P} video of this length.` : 'Not enough comparable videos yet to judge this one.';

  // ---- strengths / weaknesses vs expectation
  const strengths: string[] = [], weaknesses: string[] = [];
  for (const [k, v] of Object.entries(d.expected)) {
    const line = `${cap(OUTCOME_PLAIN[k].name)}: ${shortValue(k, v.actual)}, where ${shortValue(k, v.expected).replace(/^watched /, 'watching ')} would be normal for this platform and length`;
    if (v.z >= 0.5) strengths.push(line);
    if (v.z <= -0.5) weaknesses.push(line);
  }

  // ---- what to change next time (from the engine's current drivers)
  const drivers = await q<any>(`SELECT headline, certainty, metrics, story FROM ai_insights WHERE status='active' AND data_origin=$1 AND insight_type='driver' ORDER BY rank_score DESC`, [origin]);
  const changes: { change: string; why: string; certainty: string }[] = [];
  const past = (t: string) => t.replace(/^(do not|open|have|use|show|start|end|are|keep) /, (m0) => (({ 'do not ': 'did not ', 'open ': 'opened ', 'have ': 'had ', 'use ': 'used ', 'show ': 'showed ', 'start ': 'started ', 'end ': 'ended ', 'are ': 'were ', 'keep ': 'kept ' } as Record<string, string>)[m0] ?? m0));
  for (const dr of drivers) {
    const f = dr.metrics.feature as string, better = dr.metrics.better as string, outcome = dr.metrics.outcome as string;
    if (f === 'publish_slot') continue;
    const mine = me.features[f];
    if (mine == null || String(mine) === better) continue;
    if ((d.expected[outcome]?.z ?? -1) >= 0) continue; // this video already did well on what that pattern improves
    changes.push({ change: `Next time, ${featurePlain(f, better)} — this video ${past(featurePlain(f, String(mine)))}.`, why: dr.headline, certainty: dr.certainty });
    if (changes.length >= 3) break;
  }
  if (c && c.shape !== 'healthy') changes.unshift({ change: SHAPE_PLAIN[c.shape].fix, why: `This video's viewer pattern: ${SHAPE_PLAIN[c.shape].name.toLowerCase()}.`, certainty: 'measured' });

  // ---- other platforms
  const siblings = me.content_item_id ? rows.filter((r) => r.content_item_id === me.content_item_id && r.publication_id !== me.publication_id) : [];
  const other = siblings.map((s) => {
    const a = s.derived.avg_view_ratio, b = me.derived.avg_view_ratio;
    return { publication_id: s.publication_id, platform: s.platform, views: s.metrics.views ?? null,
      text: a != null && b != null ? `On ${PLATFORM[s.platform]}, people watched about ${Math.round(a * 100)}% of it (here: ${Math.round(b * 100)}%)${s.metrics.views != null ? `, from ${Math.round(s.metrics.views).toLocaleString('en-US')} views` : ''}.` : `Also published on ${PLATFORM[s.platform]}.` };
  });

  // ---- technical (for "show the numbers")
  const metricKeys = ['retention_3s', 'retention_8s', 'avg_view_ratio', 'engagement_rate', 'shares_saves_rate', 'retention_at_cta'];
  const comparisons = metricKeys.map((m) => {
    const v = me.derived[m]; const vals = peers.map((p) => p.derived[m]).filter((x): x is number => x != null);
    if (v == null || vals.length < 2) return null;
    return { metric: m, label: OUTCOME_PLAIN[m]?.name ?? m, value: v, cohort_median: median(vals), percentile: percentileRank(vals, v), cohort_n: vals.length };
  }).filter(Boolean);
  const rate = (s: { relative_drop: number | null; start: number; end: number }) => (s.relative_drop == null || s.end <= s.start ? null : s.relative_drop / (s.end - s.start));
  const segments = (me.segments ?? []).map((s) => {
    const ps = peers.map((p) => p.segments?.find((x) => x.code === s.code)).filter((x): x is NonNullable<typeof x> => !!x);
    const rates = ps.map(rate).filter((x): x is number => x != null);
    return { ...s, loss_rate: rate(s), cohort_loss_rate: rates.length ? median(rates) : null,
      plain: s.start_retention != null && s.relative_drop != null ? `${s.label} (${clock(s.start)}–${clock(s.end)}): of the viewers who reached it, ${inTen(s.relative_drop)} left during it${rates.length && rate(s) != null ? (rate(s)! > median(rates) * 1.25 ? ' — faster than in similar videos' : rate(s)! < median(rates) * 0.8 ? ' — slower than in similar videos' : ' — about normal') : ''}.` : null };
  });

  return {
    publication_id: publicationId, data_origin: origin, platform: me.platform,
    verdict, grade: d.grade, grade_words: d.grade_words,
    position: rank && rankList.length >= 2 ? `By how much of the video people watched, it is ${rankWords(rank, rankList.length + 1, `${P} videos`)}.` : null,
    story, shape: c ? { key: c.shape, ...SHAPE_PLAIN[c.shape] } : null,
    diagnosis: c && cohortHook != null ? hookHoldDiagnosis(c.hook_kept, c.loss_per_10s, cohortHook, cohortLoss) : null,
    moments: c ? [
      ...(c.hook_kept < 0.85 ? [{ at: `0:00–${clock(c.hook_at_sec)}`, at_sec: 0, text: `In the first ${c.hook_at_sec} seconds, ${lostWords(1 - c.hook_kept)}${c.moments.find((m) => m.at_sec <= c.hook_at_sec) ? ` — ${c.moments.find((m) => m.at_sec <= c.hook_at_sec)!.what}` : ''}.` }] : []),
      ...c.moments.filter((m) => m.at_sec > c.hook_at_sec).map((m) => ({ at: m.at, at_sec: m.at_sec, text: `At ${m.at}, ${lostWords(m.lost)} — ${m.what}.` })),
    ] : [],
    strengths, weaknesses, changes, other_platforms: other,
    how_sure: `Compared with ${peers.length} other ${P} videos. The viewer numbers come straight from ${P}; the reasons and suggestions come from patterns across all your videos, so treat them as well-informed suggestions, not guarantees.`,
    technical: { comparisons, segments, curve: c, expected: d.expected, cohort_size: peers.length, curve_resolution_sec: me.curve_resolution_sec,
      drop_offs: c?.moments.map((m) => ({ at_sec: m.at_sec, loss: m.lost })) ?? [] },
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function lostWords(loss: number) {
  const per100 = Math.round(loss * 100);
  return per100 >= 10 ? `about ${Math.round(loss * 10)} in 10 of the people who started watching left` : `about ${Math.max(1, per100)} in every 100 people who started watching left`;
}
