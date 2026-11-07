/**
 * DEMO DATA — synthetic records for testing the UI and the intelligence engine before real accounts are connected.
 * Everything created here has data_origin='demo', is shown with a DEMO badge, and is excluded from live analytics.
 * Usage: npm run seed:demo        (re-running replaces previous demo data)
 */
import { migrate } from '../db/migrate.js';
import { one, pool, q } from '../db/pool.js';
import { SyncWriter } from '../sync/writer.js';
import { rng } from '../intelligence/stats.js';
import { runIntelligence } from '../intelligence/engine.js';

const r = rng(7);
const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// "True" effects baked into the synthetic data so the engine has something to find
const OPENINGS: Record<string, { ret3: number; subject: number; narr: number; cuts: number }> = {
  product_demo_first: { ret3: 0.8, subject: 0.8, narr: 0.6, cuts: 1.6 },
  problem_first: { ret3: 0.74, subject: 1.8, narr: 0.95, cuts: 1.0 },
  question: { ret3: 0.7, subject: 2.2, narr: 0.95, cuts: 0.8 },
  company_intro: { ret3: 0.56, subject: 3.6, narr: 0.7, cuts: 0.4 },
  slow_cinematic: { ret3: 0.43, subject: 4.5, narr: 0.1, cuts: 0.1 },
};
const PRODUCTS = ['ACSR Conductor', 'AL59 Alloy Conductor', 'XLPE Power Cable', 'Solar DC Cable', 'Covered Conductor'];
const CATEGORIES = ['product_demo', 'manufacturing', 'educational', 'company_intro', 'testimonial'];

const SCRIPTS: Record<string, (p: string) => string[]> = {
  product_demo_first: (p) => [`This is the ${p} carrying full load.`, 'Watch what happens when we push it to twice the rated current.', `Here is why: the ${p} uses a high-conductivity alloy core.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'Every reel is tested before it leaves the plant.', 'Visit our website to request a quote.'],
  problem_first: (p) => ['Tired of conductors that sag and fail every summer?', `That is the problem the ${p} was built to solve.`, 'Our engineers redesigned the core from the inside.', 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'The result is a line that lasts decades.', 'Contact us for a quote today.'],
  question: (p) => ['What decides how long a power line really lasts?', 'Most people think it is the thickness. It is not.', `With the ${p}, it is the alloy and the stranding.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'That is why utilities choose it.', 'Follow us for more.'],
  company_intro: () => ['Welcome to our company.', 'We have been manufacturing conductors for over thirty years.', 'Our plant runs around the clock with modern equipment.', 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'We serve customers in many countries.', 'Visit our website to learn more.'],
  slow_cinematic: (p) => ['', '', `The ${p}. Built for the grid.`, 'Long technical specification: strand count, diameter, tensile strength, lay ratio and resistance at twenty degrees.', 'Quality you can trust.', 'Visit our website.'],
};
/** Synthetic transcript / scenes / pauses so the engine can match drop-offs to content (DEMO only). */
function demoEvents(style: string, product: string, duration: number) {
  const lines = SCRIPTS[style](product);
  const slots = [[0, 0.12], [0.12, 0.25], [0.25, 0.4], [0.4, 0.62], [0.62, 0.85], [0.86, 0.99]];
  const transcript = lines.map((text, i) => ({ start: +(slots[i][0] * duration + (style === 'slow_cinematic' && i < 2 ? 0 : 0.3)).toFixed(2), end: +(slots[i][1] * duration).toFixed(2), text })).filter((t) => t.text);
  const nScenes = style === 'slow_cinematic' ? 3 : style === 'company_intro' ? 4 : 7;
  const scenes = Array.from({ length: nScenes }, (_, i) => ({ start: +((i * duration) / nScenes).toFixed(2), end: +(((i + 1) * duration) / nScenes).toFixed(2) }));
  const silences = style === 'slow_cinematic' ? [{ start: 0, end: +(0.25 * duration).toFixed(2) }] : [];
  return { transcript, scenes, silences };
}

function curve(ret3: number, duration: number, points: number, pace: number, midDrop = 0) {
  // fast initial drop to ret3 at 3s, then exponential decay; slower decay for faster-paced edits
  const k = (0.9 - pace * 0.15) / Math.max(20, duration);
  const out: { r: number; v: number }[] = [];
  for (let i = 0; i < points; i++) {
    const ratio = points === 100 ? (i + 1) / 100 : i / (points - 1);
    const t = ratio * duration;
    let v = t <= 3 ? 1 - (1 - ret3) * (t / 3) ** 0.7 : ret3 * Math.exp(-k * (t - 3) * 1.6);
    if (t > duration * 0.85) v *= 0.93; // ending drop
    if (midDrop && t > duration * 0.42) v *= 1 - midDrop; // viewers leave at the long technical explanation
    v = clamp(v + gauss() * 0.008, 0.01, 1.2);
    out.push({ r: ratio, v });
  }
  return out;
}

await migrate();
console.log('Removing previous demo data…');
await q(`DELETE FROM ai_insights WHERE data_origin='demo'`);
await q(`DELETE FROM ai_recommendations WHERE data_origin='demo'`);
await q(`DELETE FROM ai_briefs WHERE data_origin='demo'`);
await q(`DELETE FROM content_items WHERE data_origin='demo'`);
await q(`DELETE FROM social_accounts WHERE data_origin='demo'`);

const accounts: Record<string, string> = {};
for (const [p, name] of [['instagram', 'DEMO Instagram'], ['facebook', 'DEMO Facebook Page'], ['youtube', 'DEMO YouTube Channel']]) {
  accounts[p] = (await one<any>(`INSERT INTO social_accounts (platform_code, external_account_id, display_name, data_origin, status, last_synced_at, last_sync_status)
                                 VALUES ($1,$2,$3,'demo','connected',now(),'succeeded') RETURNING id`, [p, `demo-${p}`, name])).id;
}
const cats = Object.fromEntries((await q<any>('SELECT id, code FROM content_categories')).map((c) => [c.code, c.id]));
const camp = (await one<any>(`INSERT INTO campaigns (code, name, objective) VALUES ('demo_q3_launch','DEMO Q3 product launch','lead_generation') ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).id;

const styles = Object.keys(OPENINGS);
const N = 18;
const now = Date.now();
for (let i = 0; i < N; i++) {
  const style = styles[i % styles.length];
  const o = OPENINGS[style];
  const product = pick(PRODUCTS);
  const category = style === 'company_intro' ? 'company_intro' : pick(CATEGORIES.filter((c) => c !== 'company_intro'));
  const duration = Math.round(clamp(25 + gauss() * 15 + (style === 'slow_cinematic' ? 15 : 0), 12, 90));
  const pace = clamp(o.cuts + gauss() * 0.4, 0, 4);
  const cta = r() < 0.6 ? pick(['website', 'website', 'enquiry']) : r() < 0.5 ? 'follow' : 'none';
  const ci = await one<any>(`INSERT INTO content_items (code, title, category_id, campaign_id, product, topic, data_origin, business_objective)
                             VALUES ($7,$1,$2,$3,$4,$5,'demo',$6) RETURNING id, code`,
    [`DEMO ${product} — ${style.replace(/_/g, ' ')} #${i + 1}`, cats[category], i % 3 === 0 ? camp : null, product, category.replace(/_/g, ' '), cta === 'website' || cta === 'enquiry' ? 'lead_generation' : 'product_awareness', `DEMO-${String(i + 1).padStart(3, '0')}`]);
  const subject = clamp(o.subject + gauss() * 0.4, 0.2, 6);
  const feats: [string, string | null, number | null][] = [
    ['opening_style', style, null], ['hook_type', style === 'question' ? 'question' : style === 'problem_first' ? 'problem' : style === 'product_demo_first' ? 'demo' : style === 'company_intro' ? 'company_intro' : 'none', null],
    ['subject_visible_by_sec', null, Math.round(subject * 10) / 10], ['opening_has_narration', r() < o.narr ? 'yes' : 'no', null],
    ['opening_scene_changes', null, Math.round(clamp(o.cuts + gauss() * 0.5, 0, 4))], ['product_shown_in_opening', subject <= 2 ? 'yes' : 'no', null],
    ['editing_pace', pace > 3 ? 'fast' : pace >= 1 ? 'medium' : 'slow', null], ['cuts_per_10s', null, Math.round(pace * 100) / 100],
    ['cta_type', cta, null], ['duration_sec', null, duration],
  ];
  const ev = demoEvents(style, product, duration);
  await q(`INSERT INTO video_analysis_results (content_item_id, status, analyzer_version, duration_sec, transcript, scenes, silences, summary, finished_at)
           VALUES ($1,'succeeded','demo',$2,$3,$4,$5,$6, now())`, [ci.id, duration, JSON.stringify(ev.transcript), JSON.stringify(ev.scenes), JSON.stringify(ev.silences), JSON.stringify({ demo: true })]);
  const midDrop = style === 'question' || style === 'company_intro' ? 0.25 + r() * 0.1 : r() < 0.75 ? 0.1 + r() * 0.1 : 0; // long spec sheets lose viewers
  for (const [k, v, n] of feats) {
    await q(`INSERT INTO content_features (content_item_id, feature_key, value_text, value_num, source, confidence, evidence) VALUES ($1,$2,$3,$4,'heuristic',0.7,'{"demo":true}')`, [ci.id, k, v, n]);
  }
  const published = new Date(now - (120 - i * 6.5) * 864e5 - r() * 864e5 * 2);
  for (const platform of ['instagram', 'facebook', 'youtube']) {
    if (platform === 'youtube' && r() < 0.2) continue;
    const w = new SyncWriter(accounts[platform], platform, null);
    const pubDate = new Date(published.getTime() + (platform === 'youtube' ? 864e5 : 0) + r() * 6 * 36e5);
    const pubId = await w.upsertPublication({
      platform_post_id: `demo-${platform}-${i}`, platform_video_id: `demo-v-${platform}-${i}`,
      format: platform === 'youtube' ? 'short_or_video' : 'reel', title: platform === 'youtube' ? `DEMO ${product}: ${style.replace(/_/g, ' ')}` : null,
      caption: `DEMO caption for ${product} #demo #${product.split(' ')[0].toLowerCase()}`, duration_sec: duration, published_at: pubDate.toISOString(),
      permalink: null, thumbnail_url: null,
    });
    await q(`UPDATE platform_publications SET content_item_id=$2, publication_code=$3 WHERE id=$1`, [pubId, ci.id, `${platform === 'instagram' ? 'INST' : platform === 'facebook' ? 'FB' : 'YT'}-D${String(i + 1).padStart(2, '0')}`]);
    const platformBias = platform === 'instagram' ? 0.03 : platform === 'facebook' ? -0.05 : 0;
    const ret3 = clamp(o.ret3 + platformBias + gauss() * 0.04, 0.2, 0.97);
    const pts = curve(ret3, duration, platform === 'youtube' ? 100 : 41, pace, midDrop);
    const avgRatio = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const baseViews = { instagram: 5200, facebook: 2400, youtube: 1800 }[platform]!;
    const views = Math.round(baseViews * Math.exp(gauss() * 0.5) * (0.5 + ret3));
    const reach = Math.round(views * clamp(0.72 + gauss() * 0.05, 0.4, 0.95));
    const eng = clamp(0.035 + (ret3 - 0.6) * 0.06 + gauss() * 0.006, 0.004, 0.2);
    const likes = Math.round(reach * eng * 0.7), comments = Math.round(reach * eng * 0.08), shares = Math.round(reach * eng * 0.12), saves = platform === 'instagram' ? Math.round(reach * eng * 0.1) : null;
    // history: several lifetime snapshots (growth) at different collection hours
    const growth = [0.35, 0.6, 0.82, 1];
    for (let g = 0; g < growth.length; g++) {
      const at = new Date(pubDate.getTime() + [1, 3, 7, 30][g] * 864e5);
      if (at.getTime() > now) break;
      await q(`INSERT INTO metric_snapshots (publication_id, social_account_id, platform_code, metric_key, value, availability, period, collected_at, collected_hour)
               VALUES ($1,$2,$3,'views',$4,'available','lifetime',$5,date_trunc('hour',$5::timestamptz)) ON CONFLICT DO NOTHING`, [pubId, accounts[platform], platform, Math.round(views * growth[g]), at]);
    }
    await w.pubMetric(pubId, 'views', views);
    await w.pubMetric(pubId, platform === 'facebook' ? 'reactions' : 'likes', likes);
    await w.pubMetric(pubId, 'comments', comments);
    await w.pubMetric(pubId, 'shares', shares);
    if (platform === 'instagram') await w.pubMetric(pubId, 'saves', saves);
    if (platform !== 'youtube') await w.pubMetric(pubId, 'reach', reach);
    else { await w.pubMetric(pubId, 'reach', null, 'not_supported'); await w.pubMetric(pubId, 'impressions', Math.round(views * 9 * Math.exp(gauss() * 0.3))); await w.pubMetric(pubId, 'ctr', clamp(0.045 + gauss() * 0.01, 0.005, 0.2)); }
    await w.pubMetric(pubId, 'avg_watch_time_sec', Math.round(avgRatio * duration * 10) / 10);
    await w.pubMetric(pubId, 'total_watch_time_sec', Math.round(avgRatio * duration * views));
    if (platform === 'instagram') await w.pubMetric(pubId, 'retention_curve', null, 'not_supported');
    else await w.retention(pubId, platform === 'youtube' ? 'audienceWatchRatio' : 'total_video_retention_graph', pts, duration);

  }
}
// Account-level daily metrics + follower history
for (const platform of ['instagram', 'facebook', 'youtube']) {
  let followers = { instagram: 8200, facebook: 5400, youtube: 2100 }[platform]!;
  for (let d = 120; d >= 0; d--) {
    const day = new Date(now - d * 864e5).toISOString().slice(0, 10);
    followers += Math.round(8 + gauss() * 6);
    await q(`INSERT INTO metric_snapshots (social_account_id, platform_code, metric_key, value, availability, period, period_end, collected_at, collected_hour)
             VALUES ($1,$2,'followers',$3,'available','lifetime',$4,$4::date + interval '20 hours', date_trunc('hour',$4::date + interval '20 hours')) ON CONFLICT DO NOTHING`, [accounts[platform], platform, followers, day]);
    const v = Math.round({ instagram: 1900, facebook: 900, youtube: 600 }[platform]! * Math.exp(gauss() * 0.25));
    for (const [k, val] of [['views', v], ['reach', platform === 'youtube' ? null : Math.round(v * 0.6)]] as const) {
      if (val === null) continue;
      await q(`INSERT INTO metric_snapshots (social_account_id, platform_code, metric_key, value, availability, period, period_start, period_end)
               VALUES ($1,$2,$3,$4,'available','day',$5,$5) ON CONFLICT DO NOTHING`, [accounts[platform], platform, k, val, day]);
    }
  }
  for (const [b, v] of [['IN', 62], ['AE', 9], ['US', 7], ['GB', 4], ['SA', 4]]) {
    await q(`INSERT INTO audience_insights (social_account_id, dimension, bucket, value, value_unit) VALUES ($1,'country',$2,$3,'percent') ON CONFLICT DO NOTHING`, [accounts[platform], b, v]);
  }
}
const res = await runIntelligence({ scope: 'demo' });
console.log(`Demo data created (${N} content items). Intelligence run: ${res.insights} insights`, res.coverage);
await pool.end();
