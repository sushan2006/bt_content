import { useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../lib';
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Stat } from '../components/ui';

/** Audit & Activity: who did what and when. Filters and paging run on the server. */
const PAGE = 50;
const blank = { q: '', user: '', role: '', action: '', status: '', from: '', to: '' };
type Filters = typeof blank;

const when = (v: string) => {
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const label = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-2 mb-1.5';

export default function Audit() {
  const summary = useApi<any>('/api/audit/summary');
  const opts = useApi<any>('/api/audit/filters');
  const [f, setF] = useState<Filters>(blank);
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: any[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // wait a moment after typing before searching
  useEffect(() => { const t = setTimeout(() => { setF((x) => (x.q === search ? x : { ...x, q: search })); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    if (area !== 'all') p.set('area', area);
    return p.toString();
  }, [f, area]);

  useEffect(() => {
    let live = true;
    setLoading(true); setErr(null);
    api<any>(`/api/audit?${qs}${qs ? '&' : ''}limit=${PAGE}&offset=${page * PAGE}`)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setErr((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [qs, page]);

  const set = (k: keyof Filters, v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(0); };
  const dirty = Object.entries(f).some(([k, v]) => v && k !== 'q') || !!search;
  const clear = () => { setF(blank); setSearch(''); setPage(0); };
  const s = summary.data;
  const total = data?.total ?? 0;
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, (page + 1) * PAGE);
  const sel = (k: keyof Filters, all: string, items: { v: string; t: string }[]) => (
    <select className={inputCls} value={f[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">{all}</option>{items.map((i) => <option key={i.v} value={i.v}>{i.t}</option>)}
    </select>);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>
          <div>
            <h1 className="text-2xl font-semibold text-ink leading-tight">Audit &amp; Activity</h1>
            <p className="text-sm text-ink-2">Who did what, and when. Sign-ins, videos, publishing, accounts and settings.</p>
          </div>
        </div>
        <Button href={`/api/audit/export?${qs}`}>⬇ Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Stat label="TOTAL EVENTS" value={s ? s.total.toLocaleString('en-US') : '…'} />
        <Stat label="TODAY" value={s ? s.today.toLocaleString('en-US') : '…'} />
        <Stat label="ADMIN ACTIONS" value={s ? s.admin.toLocaleString('en-US') : '…'} />
        <Stat label="VIEWER ACTIONS" value={s ? s.viewer.toLocaleString('en-US') : '…'} />
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <div className="text-xs text-ink-2">FAILED ACTIONS</div>
          <div className={`text-2xl font-semibold mt-1 tabular-nums ${s?.failed ? 'text-red-700' : 'text-ink'}`}>{s ? s.failed.toLocaleString('en-US') : '…'}</div>
        </div>
      </div>

      <Card className="mb-5">
        <input className={`${inputCls} mb-4`} placeholder="Search by user, video code, action or details, e.g. JOB-012" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div><label className={label}>User</label>{sel('user', 'All', (opts.data?.users ?? []).map((u: any) => ({ v: u.id, t: u.name })))}</div>
          <div><label className={label}>Role</label>{sel('role', 'All', (opts.data?.roles ?? []).map((r: any) => ({ v: r.code, t: r.name })))}</div>
          <div><label className={label}>Action</label>{sel('action', 'All', (opts.data?.actions ?? []).map((a: any) => ({ v: a.action, t: a.label })))}</div>
          <div><label className={label}>Status</label>{sel('status', 'All', [{ v: 'success', t: 'Success' }, { v: 'failed', t: 'Failed' }])}</div>
          <div><label className={label}>From</label><input type="date" className={inputCls} value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} /></div>
          <div><label className={label}>To</label><input type="date" className={inputCls} value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} /></div>
        </div>
        {dirty && <button className="mt-3 text-xs underline text-ink-2 hover:text-ink" onClick={clear}>Clear filters</button>}
      </Card>

      <div className="flex gap-1 border-b border-stone-200 mb-4 overflow-x-auto">
        {(s?.areas ?? [{ key: 'all', label: 'Overview' }]).filter((a: any) => a.key === 'all' || a.n > 0).map((a: any) => (
          <button key={a.key} onClick={() => { setArea(a.key); setPage(0); }}
            className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${area === a.key ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{a.label}</button>))}
      </div>

      <ErrorBox error={err} />
      <Card className="!p-0 overflow-hidden">
        {!data && loading ? <div className="text-sm text-ink-3 py-10 text-center">Loading…</div> : !data?.rows.length ? <Empty>No activity matches these filters.</Empty> : (
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-2 border-b border-stone-200 bg-stone-50/60">
                {['Time', 'User', 'Role', 'Area', 'Action', 'Item', 'Details', 'Status'].map((h) => <th key={h} className="py-3 px-4 font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className={`border-b border-stone-100 last:border-0 hover:bg-stone-50 ${r.status === 'failed' ? 'bg-red-50/40' : ''}`}>
                  <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-ink-2">{when(r.created_at)}</td>
                  <td className="py-3 px-4"><div className="text-ink">{r.user}</div>{r.email && r.email !== r.user && <div className="text-xs text-ink-3">{r.email}</div>}</td>
                  <td className="py-3 px-4">{r.role ? <Badge color={r.role === 'admin' ? 'blue' : 'gray'}>{r.role.toUpperCase()}</Badge> : <span className="text-ink-3">—</span>}</td>
                  <td className="py-3 px-4 text-ink-2 whitespace-nowrap">{r.area_label}</td>
                  <td className="py-3 px-4 font-medium text-ink whitespace-nowrap">{r.action_label}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{r.item ? <span className="font-mono text-xs text-blue-700">{r.item}</span> : <span className="text-ink-3">—</span>}</td>
                  <td className="py-3 px-4 text-ink-2 max-w-[360px]">{r.details || <span className="text-ink-3">—</span>}</td>
                  <td className="py-3 px-4"><Badge color={r.status === 'failed' ? 'red' : 'green'}>{r.status === 'failed' ? 'FAILED' : 'SUCCESS'}</Badge></td>
                </tr>))}
              </tbody>
            </table>
          </div>)}
        {total > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-stone-200 text-xs text-ink-2">
            <span>Showing {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>
            <span className="flex gap-2">
              <Button small disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>← Newer</Button>
              <Button small disabled={to >= total || loading} onClick={() => setPage(page + 1)}>Older →</Button>
            </span>
          </div>)}
      </Card>
    </>
  );
}
