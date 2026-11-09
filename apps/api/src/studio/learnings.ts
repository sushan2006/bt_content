/** Loads the learnings for a video being set up (see intelligence/learnings.ts). */
import { one, q } from '../db/pool.js';
import { buildLearnings, NextVideoContext } from '../intelligence/learnings.js';
import { styleName } from './styles.js';

/** The key a style has in the analytics (publish.ts stores a reference style as "ref_<name>"). */
async function analyticsKey(style: string | null | undefined) {
  if (!style?.startsWith('profile:')) return style ?? null;
  const p = await one<any>('SELECT name FROM style_profiles WHERE id=$1', [style.slice(8)]).catch(() => null);
  return `ref_${p?.name ?? 'custom'}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
}

export async function learningsFor(origin: 'live' | 'demo', ctx: NextVideoContext) {
  const insights = await q<any>(
    `SELECT id, insight_type, headline, certainty, rank_score, sample_size, metrics, created_at FROM ai_insights
      WHERE status='active' AND data_origin=$1 ORDER BY rank_score DESC NULLS LAST LIMIT 80`, [origin]);
  const counts = await q<any>(
    `SELECT cf.value_text AS style, count(DISTINCT ci.id)::int AS n FROM content_features cf JOIN content_items ci ON ci.id=cf.content_item_id
      WHERE cf.feature_key='edit_style' AND ci.data_origin=$1
        AND EXISTS (SELECT 1 FROM platform_publications p WHERE p.content_item_id=ci.id AND p.publishing_status='published') GROUP BY 1`, [origin]);
  const vids = await one<any>(
    `SELECT count(DISTINCT coalesce(p.content_item_id, p.id))::int AS n FROM platform_publications p JOIN social_accounts sa ON sa.id=p.social_account_id
      WHERE p.publishing_status='published' AND sa.data_origin=$1`, [origin]);
  const name = ctx.style ? await styleName(ctx.style).catch(() => ctx.style!) : null;
  return buildLearnings(insights, { ...ctx, style: await analyticsKey(ctx.style), style_name: name }, {
    videos_analysed: vids?.n ?? 0,
    updated_at: insights[0]?.created_at ? new Date(insights[0].created_at).toISOString() : null,
    style_counts: Object.fromEntries(counts.map((c) => [c.style, c.n])),
  });
}
