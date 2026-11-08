import { useState } from 'react';
import { api, can, fmt, useApi, useOrigin, withOrigin } from '../lib';
import { Badge, Button, Card, ConfidenceBadge, inputCls, Loading, PageHeader, PlatformTag, Table, Tabs } from '../components/ui';
import { useMe } from '../main';

const CAT: Record<string, string> = { content: 'Content', platform: 'Platform', publishing: 'Publishing', experiment: 'Experiment', data: 'Data to collect' };

export default function Recommendations() {
  const origin = useOrigin();
  const me = useMe();
  const [history, setHistory] = useState(false);
  const { data, reload } = useApi<any[]>(withOrigin(`/api/recommendations?history=${history}`, origin), [origin, history]);
  const exps = useApi<any[]>(withOrigin('/api/experiments', origin), [origin]);
  const review = can(me, 'recommendations.review');
  const set = async (id: string, status: string) => { const feedback = status === 'rejected' ? prompt('Why is this recommendation rejected? (helps future runs)') : null; await api(`/api/recommendations/${id}`, { method: 'PATCH', body: { status, feedback } }); reload(); };
  return (
    <>
      <PageHeader title="Recommendations" subtitle="What to create next — derived only from your historical performance, with the confidence of the finding behind it" />
      <Tabs tabs={[
        { key: 'recs', label: 'Recommendations', content: <>
          <label className="text-xs text-ink-2 flex gap-2 items-center mb-3"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Show superseded recommendations from earlier runs</label>
          {!data ? <Loading /> : <div className="space-y-3">{data.length === 0 && <Card><div className="text-sm text-ink-2">No recommendations yet. Run the analysis on the Findings page (or press Update analysis on the Overview).</div></Card>}
            {data.map((r) => (
              <div key={r.id} className="bg-white border border-stone-200 rounded-xl p-4">
                <div className="flex flex-wrap gap-2 items-center mb-1"><Badge>{CAT[r.category] ?? r.category}</Badge><ConfidenceBadge c={r.confidence} />{r.platform_code && <PlatformTag code={r.platform_code} />}
                  <Badge color={r.status === 'accepted' || r.status === 'done' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'in_test' ? 'blue' : 'gray'}>{fmt.label(r.status)}</Badge>{r.data_origin === 'demo' && <Badge color="amber">DEMO</Badge>}</div>
                <div className="font-medium">{r.title}</div>
                <p className="text-sm text-ink-2 whitespace-pre-line mt-1">{r.body}</p>
                {r.feedback && <p className="text-xs text-ink-3 mt-1">Feedback: {r.feedback}{r.reviewed_by_name && ` — ${r.reviewed_by_name}`}</p>}
                {review && r.status === 'proposed' && <div className="flex gap-2 mt-3"><Button small variant="primary" onClick={() => set(r.id, 'accepted')}>Accept</Button><Button small onClick={() => set(r.id, 'in_test')}>Start test</Button><Button small variant="danger" onClick={() => set(r.id, 'rejected')}>Reject</Button></div>}
                {review && (r.status === 'accepted' || r.status === 'in_test') && <div className="mt-3"><Button small onClick={() => set(r.id, 'done')}>Mark done</Button></div>}
              </div>))}
          </div>}
        </> },
        { key: 'exp', label: 'Experiments', content: <Experiments rows={exps.data} reload={exps.reload} canEdit={review} origin={origin} /> },
      ]} />
    </>
  );
}

function Experiments({ rows, reload, canEdit, origin }: { rows: any[] | null; reload: () => void; canEdit: boolean; origin: string }) {
  const content = useApi<any[]>(withOrigin('/api/content', origin), [origin]).data ?? [];
  const [edit, setEdit] = useState<any | null>(null);
  if (!rows) return <Loading />;
  return <Card subtitle="Controlled tests proposed for preliminary/moderate findings. Assign the videos made for each variant, then evaluate with the same statistics as the engine.">
    <Table rows={rows} empty="No experiments yet" columns={[
      { key: 'hypothesis', label: 'Hypothesis', render: (r) => <span className="text-xs">{r.hypothesis}</span> },
      { key: 'v', label: 'Variants', render: (r) => <span className="text-xs">A: {fmt.label(r.variant_a)}<br />B: {fmt.label(r.variant_b)}</span> },
      { key: 'primary_metric', label: 'Metric', render: (r) => fmt.label(r.primary_metric) },
      { key: 'n', label: 'Videos A / B', render: (r) => `${r.content_item_ids_a.length} / ${r.content_item_ids_b.length} (min ${r.min_sample_per_arm})` },
      { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
      { key: 'result', label: 'Result', render: (r) => <span className="text-xs">{r.result?.verdict ?? '—'}</span> },
      { key: 'a', label: '', render: (r) => canEdit && <div className="flex gap-1"><Button small onClick={() => setEdit({ ...r })}>Assign</Button><Button small onClick={async () => { await api(`/api/experiments/${r.id}/evaluate`, { method: 'POST' }); reload(); }}>Evaluate</Button></div> },
    ]} />
    {edit && <div className="mt-4 border-t border-stone-100 pt-4 grid md:grid-cols-2 gap-4">
      {(['content_item_ids_a', 'content_item_ids_b'] as const).map((k) => (
        <div key={k}><div className="text-xs font-medium text-ink-2 mb-1">Variant {k.endsWith('a') ? 'A' : 'B'} videos (Ctrl/Cmd-click for several)</div>
          <select multiple className={`${inputCls} h-40`} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: [...e.target.selectedOptions].map((o) => o.value) })}>{content.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></div>))}
      <div className="flex gap-2"><Button variant="primary" onClick={async () => { await api(`/api/experiments/${edit.id}`, { method: 'PATCH', body: { content_item_ids_a: edit.content_item_ids_a, content_item_ids_b: edit.content_item_ids_b, status: 'running' } }); setEdit(null); reload(); }}>Save</Button><Button onClick={() => setEdit(null)}>Cancel</Button></div>
    </div>}
  </Card>;
}
