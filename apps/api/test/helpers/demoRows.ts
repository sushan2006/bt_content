/** Demo data → the same rows the engine gets from the database (through buildRows), for tests without a database. */
import { generateDemo } from '../../src/scripts/demoData.js';
import { buildRows } from '../../src/intelligence/dataset.js';

export const TEMPLATE = [{ code: 'opening', label: 'Opening', start: 0, end: 3 }, { code: 'hook', label: 'Hook continuation', start: 3, end: 8 },
  { code: 'main', label: 'Main content', start: 8, end: 20 }, { code: 'demo', label: 'Explanation / demo', start: 20, end: 40 },
  { code: 'ending', label: 'Ending & CTA', start: '-15%', end: '100%' }] as any;

export function demoRows(opts: { now?: number; seed?: number; n?: number } = {}) {
  const items = generateDemo(opts);
  const pubs: any[] = [], metrics: any[] = [], curves: any[] = [], feats: any[] = [], analyses: any[] = [];
  items.forEach((it, i) => {
    const cid = `c${i}`;
    for (const [k, t, n] of it.features) feats.push({ content_item_id: cid, feature_key: k, value_text: t, value_num: n });
    analyses.push({ content_item_id: cid, transcript: it.analysis.transcript, scenes: it.analysis.scenes, silences: it.analysis.silences, frames: null });
    for (const p of it.posts) {
      const pid = `${cid}-${p.platform}`;
      pubs.push({ publication_id: pid, content_item_id: cid, content_code: it.code, title: it.title, platform: p.platform, format: p.format, publication_code: p.code,
        published_at: p.published_at, is_paid: false, duration: p.duration, category: it.category, data_origin: 'demo' });
      for (const [k, v, a] of p.metrics) metrics.push({ publication_id: pid, metric_key: k, value: v, availability: a ?? (v == null ? 'unavailable' : 'available') });
      if (p.retention) curves.push({ publication_id: pid, points: p.retention, duration_sec: p.duration });
    }
  });
  return buildRows({ pubs, metrics, curves, feats, analyses, tpl: TEMPLATE });
}
