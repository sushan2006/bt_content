import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db/pool.js';
import { requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { originOf } from './content.js';
import { runIntelligence } from '../intelligence/engine.js';
import { loadDataset } from '../intelligence/dataset.js';
import { cliffsDelta, confidenceFor, mannWhitney, median } from '../intelligence/stats.js';

export async function insightRoutes(app: FastifyInstance) {
  app.get('/api/insights', { preHandler: requirePermission('insights.view') }, async (req) => {
    const qs = req.query as any;
    return q(`SELECT id, run_id, insight_type, title, headline, story, certainty, observation, evidence_level, confidence, sample_size, effect_size, p_value,
                     narrative_source, data_origin, created_at, cohort, rank_score
                FROM ai_insights WHERE status='active' AND data_origin=$1 AND ($2::text IS NULL OR insight_type=$2)
               ORDER BY rank_score DESC NULLS LAST, created_at DESC`, [originOf(req), qs.type ?? null]);
  });
  app.get('/api/insights/:id', { preHandler: requirePermission('insights.view') }, async (req, reply) => {
    const r = await one<any>('SELECT * FROM ai_insights WHERE id=$1', [(req.params as any).id]);
    if (!r) return reply.code(404).send({ error: 'Not found' });
    return r;
  });
  app.post('/api/insights/run', { preHandler: requirePermission('analysis.run') }, async (req) => {
    const { scope } = z.object({ scope: z.enum(['live', 'demo']).default('live') }).parse(req.body ?? {});
    const res = await runIntelligence({ scope, userId: req.user_!.id });
    await audit(req.user_!.id, 'intelligence.run', 'ai_insights', res.runId, res);
    return res;
  });
  app.get('/api/brief', { preHandler: requirePermission('insights.view') }, async (req) =>
    one(`SELECT brief, created_at, run_id FROM ai_briefs WHERE data_origin=$1 ORDER BY created_at DESC LIMIT 1`, [originOf(req)]));
  app.get('/api/insights-runs/latest', { preHandler: requirePermission('insights.view') }, async (req) =>
    one(`SELECT run_id, min(created_at) AS created_at, count(*)::int AS insights FROM ai_insights WHERE data_origin=$1 AND status='active' GROUP BY run_id ORDER BY 2 DESC LIMIT 1`, [originOf(req)]));

  app.get('/api/recommendations', { preHandler: requirePermission('insights.view') }, async (req) =>
    q(`SELECT r.*, u.full_name AS reviewed_by_name FROM ai_recommendations r LEFT JOIN users u ON u.id=r.reviewed_by
        WHERE r.data_origin=$1 AND ($2::boolean OR r.status <> 'rejected' OR r.feedback NOT LIKE 'superseded%')
        ORDER BY (r.status='proposed') DESC, r.priority, CASE r.confidence WHEN 'strong' THEN 1 WHEN 'moderate' THEN 2 WHEN 'preliminary' THEN 3 ELSE 4 END, r.created_at DESC LIMIT 200`,
      [originOf(req), (req.query as any).history === 'true']));
  app.patch('/api/recommendations/:id', { preHandler: requirePermission('recommendations.review') }, async (req) => {
    const b = z.object({ status: z.enum(['proposed', 'accepted', 'rejected', 'in_test', 'done']), feedback: z.string().nullish() }).parse(req.body);
    const r = await one(`UPDATE ai_recommendations SET status=$2, feedback=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 RETURNING *`, [(req.params as any).id, b.status, b.feedback ?? null, req.user_!.id]);
    await audit(req.user_!.id, 'recommendation.review', 'ai_recommendation', (req.params as any).id, b);
    return r;
  });

  // experiments belong to the live or demo data of the recommendation that proposed them (never mixed)
  app.get('/api/experiments', { preHandler: requirePermission('insights.view') }, async (req) =>
    q(`SELECT e.*, r.title AS recommendation_title FROM analysis_experiments e LEFT JOIN ai_recommendations r ON r.id=e.recommendation_id
        WHERE coalesce(r.data_origin, 'live') = $1 ORDER BY e.created_at DESC LIMIT 200`, [originOf(req)]));
  app.patch('/api/experiments/:id', { preHandler: requirePermission('recommendations.review') }, async (req) => {
    const b = z.object({ status: z.enum(['planned', 'running', 'concluded', 'abandoned']).optional(), content_item_ids_a: z.array(z.string().uuid()).optional(), content_item_ids_b: z.array(z.string().uuid()).optional() }).parse(req.body);
    return one(`UPDATE analysis_experiments SET status=coalesce($2,status), content_item_ids_a=coalesce($3,content_item_ids_a), content_item_ids_b=coalesce($4,content_item_ids_b) WHERE id=$1 RETURNING *`,
      [(req.params as any).id, b.status ?? null, b.content_item_ids_a ?? null, b.content_item_ids_b ?? null]);
  });
  /** Evaluate an experiment from its assigned content items (same statistics as the engine). */
  app.post('/api/experiments/:id/evaluate', { preHandler: requirePermission('recommendations.review') }, async (req, reply) => {
    const e = await one<any>(`SELECT e.*, coalesce(r.data_origin, 'live') AS data_origin FROM analysis_experiments e LEFT JOIN ai_recommendations r ON r.id=e.recommendation_id WHERE e.id=$1`, [(req.params as any).id]);
    if (!e) return reply.code(404).send({ error: 'Not found' });
    const ds = await loadDataset(e.data_origin === 'demo' ? 'demo' : 'live');
    const vals = (ids: string[]) => ds.filter((r) => r.content_item_id && ids.includes(r.content_item_id)).map((r) => r.derived[e.primary_metric]).filter((x): x is number => x != null);
    const a = vals(e.content_item_ids_a), b = vals(e.content_item_ids_b);
    const cfg = (await one<any>(`SELECT value FROM app_settings WHERE key='analysis'`))?.value;
    const p = a.length && b.length ? mannWhitney(a, b).p : 1, d = a.length && b.length ? cliffsDelta(a, b) : 0;
    const enough = a.length >= e.min_sample_per_arm && b.length >= e.min_sample_per_arm;
    const result = { n_a: a.length, n_b: b.length, median_a: a.length ? median(a) : null, median_b: b.length ? median(b) : null, p_value: p, cliffs_delta: d,
      confidence: confidenceFor(a.length, b.length, p, d, cfg), enough_samples: enough,
      verdict: !enough ? `Not enough data yet: need ${e.min_sample_per_arm} publications per variant.` : p < (cfg?.alpha ?? 0.05) ? `Variant ${d > 0 ? 'A' : 'B'} performs better on ${e.primary_metric}.` : 'No clear difference detected.' };
    await q(`UPDATE analysis_experiments SET result=$2, status=CASE WHEN $3 THEN 'concluded' ELSE status END WHERE id=$1`, [e.id, JSON.stringify(result), enough]);
    return result;
  });
}
