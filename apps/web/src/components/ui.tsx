import { ReactNode, useEffect, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { fmt, PLATFORM_COLORS, PLATFORM_NAMES } from '../lib';

export function Card({ title, subtitle, actions, children, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-stone-200 rounded-xl p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>{title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}{subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}</div>
          {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4" title={hint}>
      <div className="text-xs text-ink-2 flex items-center gap-1">{label}{hint && <span className="text-ink-3 cursor-help">ⓘ</span>}</div>
      <div className="text-2xl font-semibold text-ink mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-2 mt-1">{sub}</div>}
    </div>
  );
}

const tone: Record<string, string> = {
  gray: 'bg-stone-100 text-stone-700 border-stone-200', blue: 'bg-blue-50 text-blue-800 border-blue-200', green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-200', red: 'bg-red-50 text-red-800 border-red-200', violet: 'bg-violet-50 text-violet-800 border-violet-200',
};
export function Badge({ children, color = 'gray', title }: { children: ReactNode; color?: keyof typeof tone; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${tone[color]}`}>{children}</span>;
}

export function PlatformTag({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ background: PLATFORM_COLORS[code] ?? '#8a8984' }} />{PLATFORM_NAMES[code] ?? code}
    </span>
  );
}

export const CONFIDENCE: Record<string, { color: keyof typeof tone; icon: string; text: string }> = {
  strong: { color: 'green', icon: '●●●', text: 'Strong — large, consistent association. Still confirm causality with a controlled test.' },
  moderate: { color: 'blue', icon: '●●○', text: 'Moderate — statistically clear association in enough videos. Correlation, not proven cause.' },
  preliminary: { color: 'amber', icon: '●○○', text: 'Preliminary — small sample or weak signal. Needs controlled testing.' },
  insufficient: { color: 'gray', icon: '○○○', text: 'Insufficient data.' },
};
export function ConfidenceBadge({ c }: { c: string }) {
  const x = CONFIDENCE[c] ?? CONFIDENCE.insufficient;
  return <Badge color={x.color} title={x.text}><span className="tracking-tighter">{x.icon}</span> {fmt.label(c)}</Badge>;
}
export const EVIDENCE: Record<string, { label: string; color: keyof typeof tone; text: string }> = {
  direct_data: { label: 'Direct data', color: 'violet', text: 'What the platform data directly shows.' },
  statistical_association: { label: 'Statistical association', color: 'blue', text: 'A pattern that is statistically associated with performance — not proven cause.' },
  hypothesis: { label: 'AI hypothesis', color: 'amber', text: 'A possible explanation that has not been tested.' },
  needs_testing: { label: 'Needs testing', color: 'amber', text: 'Signal too weak or sample too small: run a controlled test.' },
};
export function EvidenceBadge({ e }: { e: string }) {
  const x = EVIDENCE[e] ?? EVIDENCE.hypothesis;
  return <Badge color={x.color} title={x.text}>{x.label}</Badge>;
}

/** Shows a metric value or the reason it is missing — never an invented zero. */
export function MetricValue({ value, availability, format = fmt.n }: { value: number | null | undefined; availability?: string; format?: (v: number) => string }) {
  if (availability && availability !== 'available') {
    const t: Record<string, string> = { unavailable: 'No data returned by the platform yet', not_supported: 'Not provided by this platform\'s API', permission_missing: 'Missing API permission', error: 'Collection error — see integration logs' };
    return <span className="text-ink-3 text-xs" title={t[availability] ?? availability}>{availability === 'not_supported' ? 'n/a (API)' : availability === 'permission_missing' ? 'no permission' : 'unavailable'}</span>;
  }
  return <span className="tabular-nums">{value == null ? '—' : format(value)}</span>;
}

export function Button({ children, onClick, variant = 'secondary', disabled, type = 'button', href, small }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; type?: 'button' | 'submit'; href?: string; small?: boolean }) {
  const cls = {
    primary: 'bg-ink text-white hover:bg-stone-800 border-ink', secondary: 'bg-white text-ink border-stone-300 hover:bg-stone-50',
    danger: 'bg-white text-red-700 border-red-300 hover:bg-red-50', ghost: 'bg-transparent border-transparent text-ink-2 hover:text-ink',
  }[variant];
  const c = `inline-flex items-center gap-1.5 border rounded-lg ${small ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'} font-medium disabled:opacity-50 ${cls}`;
  return href ? <a href={href} className={c}>{children}</a> : <button type={type} className={c} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="text-ink-2 text-xs font-medium">{label}</span><div className="mt-1">{children}</div>{hint && <span className="text-[11px] text-ink-3">{hint}</span>}</label>;
}
export const inputCls = 'w-full border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200';

export function Empty({ children }: { children: ReactNode }) { return <div className="text-sm text-ink-2 py-8 text-center">{children}</div>; }
export function Loading() { return <div className="text-sm text-ink-3 py-10 text-center">Loading…</div>; }
export function ErrorBox({ error }: { error: string | null }) { return error ? <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-3 text-sm">{error}</div> : null; }

export function Chart({ option, height = 280 }: { option: any; height?: number }) {
  const base = {
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: '#52514e' },
    grid: { left: 48, right: 16, top: 36, bottom: 32, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e7e5e4', textStyle: { color: '#0b0b0b', fontSize: 12 } },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#52514e', fontSize: 12 } },
  };
  const merged = { ...base, ...option, grid: { ...base.grid, ...(option.grid ?? {}) }, tooltip: { ...base.tooltip, ...(option.tooltip ?? {}) }, legend: option.legend === false ? undefined : { ...base.legend, ...(option.legend ?? {}) } };
  // a chart created while its tab or panel was hidden gets width 0: size it again once it can be seen
  const ref = useRef<any>(null);
  useEffect(() => {
    const fit = () => { try { ref.current?.getEchartsInstance()?.resize(); } catch { /* not mounted */ } };
    const t = setTimeout(fit, 120);
    document.addEventListener('visibilitychange', fit);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', fit); };
  }, []);
  return <ReactECharts ref={ref} option={merged} style={{ height }} notMerge />;
}
export const axisStyle = {
  axisLine: { lineStyle: { color: '#d6d3d1' } }, axisTick: { show: false }, axisLabel: { color: '#52514e', fontSize: 11 },
  splitLine: { lineStyle: { color: '#f0efec' } },
};

export function Table({ columns, rows, empty = 'No data', onRow }: { columns: { key: string; label: ReactNode; render?: (r: any) => ReactNode; align?: 'right' | 'left'; className?: string }[]; rows: any[]; empty?: string; onRow?: (r: any) => void }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-2 border-b border-stone-200">{columns.map((c) => <th key={c.key} className={`py-2 px-2 font-medium whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-stone-100 last:border-0 ${onRow ? 'cursor-pointer hover:bg-stone-50' : ''}`}>
            {columns.map((c) => <td key={c.key} className={`py-2 px-2 align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.className ?? ''}`}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, initial }: { tabs: { key: string; label: string; content: ReactNode }[]; initial?: string }) {
  const [k, setK] = useState(initial ?? tabs[0]?.key);
  return (
    <div>
      <div className="flex gap-1 border-b border-stone-200 mb-4">
        {tabs.map((t) => <button key={t.key} onClick={() => setK(t.key)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${k === t.key ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{t.label}</button>)}
      </div>
      {tabs.find((t) => t.key === k)?.content}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div><h1 className="text-2xl font-semibold text-ink">{title}</h1>{subtitle && <p className="text-sm text-ink-2 mt-1">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const CERTAINTY: Record<string, { color: 'green' | 'blue' | 'amber' | 'gray' | 'violet'; icon: string; text: string }> = {
  'strong evidence': { color: 'green', icon: '●●●', text: 'Seen consistently across many videos and very unlikely to be chance. Still a pattern, not proof — confirm with a test.' },
  'good evidence': { color: 'blue', icon: '●●○', text: 'Consistent across enough videos to act on. Keep measuring.' },
  'early signal': { color: 'amber', icon: '●○○', text: 'Based on few videos. Worth testing before making it standard.' },
  'not enough data': { color: 'gray', icon: '○○○', text: 'There is not enough data to say yet.' },
  measured: { color: 'violet', icon: '◆', text: 'Read directly from the platform data for this video.' },
};
export function CertaintyBadge({ c }: { c: string }) {
  const x = CERTAINTY[c] ?? CERTAINTY['not enough data'];
  return <Badge color={x.color} title={x.text}><span className="tracking-tighter">{x.icon}</span> {c.charAt(0).toUpperCase() + c.slice(1)}</Badge>;
}

export const GRADE: Record<string, { color: string; bg: string }> = {
  A: { color: 'text-emerald-800', bg: 'bg-emerald-50 border-emerald-200' }, B: { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  C: { color: 'text-stone-700', bg: 'bg-stone-50 border-stone-200' }, D: { color: 'text-amber-800', bg: 'bg-amber-50 border-amber-200' }, E: { color: 'text-red-800', bg: 'bg-red-50 border-red-200' },
};
export function GradeBadge({ grade, words }: { grade: string | null; words?: string | null }) {
  if (!grade) return null;
  const g = GRADE[grade] ?? GRADE.C;
  return <span className={`inline-flex items-center gap-2 border rounded-lg px-2.5 py-1 text-sm font-medium ${g.bg} ${g.color}`} title="Compared with what we would expect for this platform and video length"><span className="text-base font-semibold">{grade}</span>{words && <span className="font-normal">{words}</span>}</span>;
}

export function Disclosure({ label = 'Show the numbers', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      <button className="text-xs text-ink-2 hover:text-ink font-medium" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {label}</button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** One labelled part of a plain-language story. */
export function StoryPart({ label, children, tone = 'plain' }: { label: string; children: ReactNode; tone?: 'plain' | 'action' | 'soft' }) {
  if (!children) return null;
  const cls = tone === 'action' ? 'bg-blue-50/60 border border-blue-100 rounded-lg p-3' : tone === 'soft' ? 'bg-stone-50 rounded-lg p-3' : '';
  return <div className={cls}><div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">{label}</div><div className="text-[15px] leading-relaxed text-ink">{children}</div></div>;
}
