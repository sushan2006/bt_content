import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, fmt, useApi, useOrigin, withOrigin } from '../lib';
import { Badge, Button, Card, CertaintyBadge, Disclosure, ErrorBox, EvidenceBadge, inputCls, Loading, PageHeader, PlatformTag, StoryPart, Table } from '../components/ui';
import { useMe } from '../main';

const TYPES: Record<string, string> = {
  driver: 'What makes videos work', curve_pattern: 'Where viewers leave', content_risk: 'Moments that lose viewers', cta_reach: 'Call to action',
  platform_fit: 'Platforms', breakout: 'Breakout videos', trend: 'Trend', data_coverage: 'Missing data',
};
const LEGEND: [string, string][] = [['strong evidence', 'act on it'], ['good evidence', 'act on it and keep measuring'], ['early signal', 'test it on the next videos first']];

export default function Insights() {
  const origin = useOrigin();
  const me = useMe();
  const [type, setType] = useState('');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, reload } = useApi<any[]>(withOrigin('/api/insights', origin), [origin]);
  const latest = useApi<any>(withOrigin('/api/insights-runs/latest', origin), [origin, data]).data;
  const rows = (data ?? []).filter((i) => !type || i.insight_type === type);
  const run = async () => { setRunning(true); setErr(null); try { await api('/api/insights/run', { body: { scope: origin } }); reload(); } catch (e) { setErr((e as Error).message); } finally { setRunning(false); } };
  return (
    <>
      <PageHeader title="Findings" subtitle={<>What your own videos show, most important first.{latest && <> Updated {fmt.ago(latest.created_at)}.</>}</>}
        actions={can(me, 'analysis.run') && <Button variant="primary" onClick={run} disabled={running}>{running ? 'Analysing…' : 'Run analysis now'}</Button>} />
      <ErrorBox error={err} />
      <div className="flex flex-wrap gap-x-5 gap-y-1 items-center text-xs text-ink-2 mb-4">
        <span className="font-medium text-ink-3">How sure we are:</span>
        {LEGEND.map(([c, t]) => <span key={c} className="inline-flex items-center gap-1.5"><CertaintyBadge c={c} /> {t}</span>)}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setType('')} className={`px-3 py-1.5 rounded-full text-sm border ${!type ? 'bg-ink text-white border-ink' : 'bg-white border-stone-300 text-ink-2'}`}>All</button>
        {Object.entries(TYPES).filter(([k]) => (data ?? []).some((i) => i.insight_type === k)).map(([k, v]) => (
          <button key={k} onClick={() => setType(k)} className={`px-3 py-1.5 rounded-full text-sm border ${type === k ? 'bg-ink text-white border-ink' : 'bg-white border-stone-300 text-ink-2'}`}>{v}</button>
        ))}
      </div>
      {!data ? <Loading /> : rows.length === 0 ? <Card><div className="text-sm text-ink-2 text-center py-6">No findings yet. Connect accounts, link posts to their original videos, upload the videos for analysis, then run the analysis.</div></Card> : (
        <div className="space-y-4">{rows.map((i) => <Finding key={i.id} i={i} />)}</div>
      )}
    </>
  );
}

function Finding({ i }: { i: any }) {
  const s = i.story ?? {};
  const todo = (s.what_to_do ?? '').replace(/^For the next videos: /, '');
  return (
    <article className="bg-white border border-stone-200 rounded-xl p-5">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <Badge>{TYPES[i.insight_type] ?? fmt.label(i.insight_type)}</Badge>
        <CertaintyBadge c={i.certainty ?? 'not enough data'} />
        {i.cohort?.platform && i.cohort.platform !== 'all' && <PlatformTag code={i.cohort.platform} />}
      </div>
      <h2 className="text-lg font-semibold leading-snug text-ink">{i.headline ?? i.title}</h2>
      {todo && <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold">What to do</div>
        <div className="text-[15px] text-ink leading-relaxed">{todo.charAt(0).toUpperCase() + todo.slice(1)}</div>
        {s.impact && <div className="text-xs text-ink-2 mt-1">{s.impact}</div>}
      </div>}
      <Disclosure label="Why we think this">
        <div className="grid gap-4">
          <StoryPart label="What happened">{s.what_happened ?? i.observation}</StoryPart>
          {s.why && <StoryPart label="Likely reason">{s.why}</StoryPart>}
          <StoryPart label="How sure we are">{s.how_sure}</StoryPart>
        </div>
        <Disclosure label="Show the videos and the statistics"><Evidence id={i.id} /></Disclosure>
      </Disclosure>
    </article>
  );
}

function Evidence({ id }: { id: string }) {
  const { data } = useApi<any>(`/api/insights/${id}`, [id]);
  if (!data) return <Loading />;
  const items = data.compared_items ?? [];
  const m = data.metrics ?? {};
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2 items-center text-xs text-ink-2">
        <EvidenceBadge e={data.evidence_level} /> <span>Videos compared: {data.sample_size}</span>
        {m.p_permutation != null && <span>· Chance of a pattern this strong by luck (shuffle test): {(+m.p_permutation).toFixed(3)}</span>}
        {m.q_value != null && <span>· After allowing for all patterns checked (q): {(+m.q_value).toFixed(3)}</span>}
        {m.probability_direction != null && <span>· Re-samples agreeing on the direction: {Math.round(m.probability_direction * 100)}%</span>}
        {m.interval_90 && <span>· 90% range of the difference: {fmtVal(m.outcome, m.interval_90[0])} to {fmtVal(m.outcome, m.interval_90[1])}</span>}
        {m.model_r2 != null && <span>· Model explains {Math.round(Math.max(0, m.model_r2) * 100)}% of the variation</span>}
      </div>
      {m.method && <div className="text-xs text-ink-3">Method: {m.method}. Controls: {(m.controls ?? []).join(', ')}.</div>}
      {items.length > 0 && <Table rows={items} columns={[
        { key: 'title', label: 'Video', render: (r) => r.publication_id ? <Link className="hover:underline" to={`/publication/${r.publication_id}`}>{r.content_code && <span className="text-ink-3 mr-1">{r.content_code}</span>}{r.title}</Link> : r.content_item_id ? <Link className="hover:underline" to={`/content/${r.content_item_id}`}>{r.content_code} {r.title}</Link> : r.title },
        ...(items[0]?.platform ? [{ key: 'platform', label: 'Platform', render: (r: any) => <PlatformTag code={r.platform} /> }] : []),
        ...(items[0]?.group !== undefined ? [{ key: 'group', label: 'Group', render: (r: any) => fmt.label(r.group) }] : []),
        ...(items[0]?.value !== undefined ? [{ key: 'value', label: 'Value', align: 'right' as const, render: (r: any) => fmtVal(r.metric, r.value) }] : []),
      ]} />}
    </div>
  );
}
function fmtVal(metric: string, v: number | null) {
  if (v == null) return '—';
  if (metric === 'times as fast' || metric === 'times usual views') return `${(+v).toFixed(1)}×`;
  if (metric === 'engagement_rate') return `${(v * 1000).toFixed(0)} per 1,000`;
  return fmt.pct(v, 0);
}
