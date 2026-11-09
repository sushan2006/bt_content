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
import { generateDemo } from './demoData.js';

const r = rng(17);
const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

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

const items = generateDemo({ now: Date.now() });
const N = items.length;
const now = Date.now();
for (const it of items) {
  const ci = await one<any>(`INSERT INTO content_items (code, title, category_id, campaign_id, product, topic, data_origin, business_objective)
                             VALUES ($7,$1,$2,$3,$4,$5,'demo',$6) RETURNING id, code`,
    [it.title, cats[it.category], it.campaign ? camp : null, it.product, it.category.replace(/_/g, ' '), it.objective, it.code]);
  await q(`INSERT INTO video_analysis_results (content_item_id, status, analyzer_version, duration_sec, transcript, scenes, silences, summary, finished_at)
           VALUES ($1,'succeeded','demo',$2,$3,$4,$5,$6, now())`, [ci.id, it.analysis.duration, JSON.stringify(it.analysis.transcript), JSON.stringify(it.analysis.scenes), JSON.stringify(it.analysis.silences), JSON.stringify({ demo: true })]);
  for (const [k, v, n] of it.features) {
    await q(`INSERT INTO content_features (content_item_id, feature_key, value_text, value_num, source, confidence, evidence) VALUES ($1,$2,$3,$4,'heuristic',0.7,'{"demo":true}')`, [ci.id, k, v, n]);
  }
  for (const p of it.posts) {
    const w = new SyncWriter(accounts[p.platform], p.platform, null);
    const pubId = await w.upsertPublication({ platform_post_id: p.post_id, platform_video_id: p.video_id, format: p.format, title: p.title, caption: p.caption,
      duration_sec: p.duration, published_at: p.published_at, permalink: null, thumbnail_url: null });
    await q(`UPDATE platform_publications SET content_item_id=$2, publication_code=$3 WHERE id=$1`, [pubId, ci.id, p.code]);
    // history: several lifetime snapshots (growth) at different collection hours
    for (const g of p.growth) {
      await q(`INSERT INTO metric_snapshots (publication_id, social_account_id, platform_code, metric_key, value, availability, period, collected_at, collected_hour)
               VALUES ($1,$2,$3,'views',$4,'available','lifetime',$5,date_trunc('hour',$5::timestamptz)) ON CONFLICT DO NOTHING`, [pubId, accounts[p.platform], p.platform, g.views, g.at]);
    }
    for (const [k, v, avail] of p.metrics) await w.pubMetric(pubId, k, v, (avail as any) ?? undefined);
    if (p.retention) await w.retention(pubId, p.platform === 'youtube' ? 'audienceWatchRatio' : 'total_video_retention_graph', p.retention, p.duration);
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
