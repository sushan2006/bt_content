import { useApi } from '../lib';
import { inputCls } from './ui';

export interface FilterState { days: string; from: string; to: string; platform: string; category: string; campaign: string; distribution: string }
export const defaultFilters: FilterState = { days: '30', from: '', to: '', platform: '', category: '', campaign: '', distribution: '' };
export const filterQuery = (f: FilterState) => {
  const p = new URLSearchParams();
  if (f.days === 'custom') { if (f.from) p.set('from', f.from); if (f.to) p.set('to', f.to); } else p.set('days', f.days);
  for (const k of ['platform', 'category', 'campaign', 'distribution'] as const) if (f[k]) p.set(k, f[k]);
  return p.toString();
};

/** One row of filters above the charts. */
export function Filters({ value, onChange, show = ['range', 'platform', 'category', 'campaign', 'distribution'] }: { value: FilterState; onChange: (f: FilterState) => void; show?: string[] }) {
  const cats = useApi<any[]>('/api/categories').data ?? [];
  const camps = useApi<any[]>('/api/campaigns').data ?? [];
  const set = (k: keyof FilterState, v: string) => onChange({ ...value, [k]: v });
  const sel = `${inputCls} !w-auto !py-1.5`;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      {show.includes('range') && (
        <select className={sel} value={value.days} onChange={(e) => set('days', e.target.value)}>
          <option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="custom">Custom range…</option>
        </select>
      )}
      {value.days === 'custom' && <><input type="date" className={sel} value={value.from} onChange={(e) => set('from', e.target.value)} /><span className="text-ink-3">–</span><input type="date" className={sel} value={value.to} onChange={(e) => set('to', e.target.value)} /></>}
      {show.includes('platform') && <select className={sel} value={value.platform} onChange={(e) => set('platform', e.target.value)}><option value="">All platforms</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option></select>}
      {show.includes('category') && <select className={sel} value={value.category} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {show.includes('campaign') && <select className={sel} value={value.campaign} onChange={(e) => set('campaign', e.target.value)}><option value="">All campaigns</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {show.includes('distribution') && <select className={sel} value={value.distribution} onChange={(e) => set('distribution', e.target.value)} title="Only where the platform reports paid status"><option value="">Organic + paid</option><option value="organic">Organic only</option><option value="paid">Paid only</option></select>}
    </div>
  );
}
