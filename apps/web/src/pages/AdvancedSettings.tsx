import { useEffect, useState } from 'react';
import { api, useApi } from '../lib';
import { Button, Card, ErrorBox, Field, inputCls } from '../components/ui';

/** Settings of the analytics side, as plain labelled fields. Values are checked here and again by the API. */
const DEFAULTS = {
  analysis: { min_sample_preliminary: 4, min_sample_moderate: 8, min_sample_strong: 15, alpha: 0.05, bootstrap_iterations: 2000 },
  sync: { max_media_per_sync: 500 },
};
const ZONES: string[] = (() => { try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['Asia/Kolkata', 'UTC']; } })();
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));
const inRange = (n: number, lo: number, hi: number, whole = false) => Number.isFinite(n) && n >= lo && n <= hi && (!whole || Number.isInteger(n));

/** Save button with its own "Saved" and error text. */
function SaveBar({ onSave, label = 'Save', extra }: { onSave: () => Promise<void>; label?: string; extra?: React.ReactNode }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <ErrorBox error={err} />
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="primary" disabled={state === 'busy'} onClick={async () => {
          setErr(null); setState('busy');
          try { await onSave(); setState('saved'); setTimeout(() => setState('idle'), 2500); } catch (e) { setErr((e as Error).message); setState('idle'); }
        }}>{state === 'busy' ? 'Saving…' : label}</Button>
        {extra}
        {state === 'saved' && <span className="text-sm text-emerald-700">Saved ✓</span>}
      </div>
    </div>
  );
}

const put = (key: string, body: unknown) => api(`/api/settings/${key}`, { method: 'PUT', body });

export default function AdvancedSettings() {
  const { data, reload } = useApi<any>('/api/settings');
  const seg = useApi<any[]>('/api/segment-templates');
  if (!data) return <div className="text-sm text-ink-3 py-10 text-center">Loading…</div>;
  return (
    <div className="space-y-5 max-w-3xl">
      <p className="text-sm text-ink-2">Settings for the analytics side (the posts pulled from Instagram, Facebook and YouTube). The defaults are fine; the one thing worth setting is your company.</p>
      <CompanyForm data={data} reload={reload} />
      <SyncForm data={data} reload={reload} />
      <details className="bg-white border border-stone-200 rounded-xl">
        <summary className="px-5 py-4 cursor-pointer text-[15px] font-semibold text-ink select-none">Expert settings <span className="font-normal text-xs text-ink-2">· you rarely need these</span></summary>
        <div className="px-5 pb-5 space-y-6 border-t border-stone-100 pt-5">
          <AnalysisForm data={data} reload={reload} />
          <SegmentsForm templates={seg.data} reload={seg.reload} />
        </div>
      </details>
    </div>
  );
}

function CompanyForm({ data, reload }: { data: any; reload: () => void }) {
  const c = data.company ?? {};
  const [name, setName] = useState(c.name ?? '');
  const [website, setWebsite] = useState(c.website ?? '');
  const [phrases, setPhrases] = useState((c.intro_keywords ?? []).join('\n'));
  const [tz, setTz] = useState(c.timezone ?? 'Asia/Kolkata');
  return (
    <Card title="Your company" subtitle="Used when the analysis looks at how your videos open, and for the best time of day to post.">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Company name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="BridgeThings" /></Field>
        <Field label="Website"><input className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" /></Field>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Field label="Phrases that start a company introduction" hint="One per line. When a video opens with one of these, it counts as a company-introduction opening.">
          <textarea className={`${inputCls} h-32`} value={phrases} onChange={(e) => setPhrases(e.target.value)} />
        </Field>
        <Field label="Timezone" hint="Posting times are shown and analysed in this timezone.">
          <select className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)}>{(ZONES.includes(tz) ? ZONES : [tz, ...ZONES]).map((z) => <option key={z}>{z}</option>)}</select>
        </Field>
      </div>
      <SaveBar onSave={async () => {
        if (!name.trim()) throw new Error('Enter the company name.');
        const list = String(phrases).split('\n').map((s) => s.trim()).filter(Boolean);
        await put('company', { ...c, name: name.trim(), website: website.trim(), intro_keywords: list, timezone: tz });
        reload();
      }} />
    </Card>
  );
}

function SyncForm({ data, reload }: { data: any; reload: () => void }) {
  const s = data.sync ?? {};
  const [hours, setHours] = useState(String(Math.round(((s.interval_minutes ?? 360) / 60) * 100) / 100));
  const [back, setBack] = useState(String(s.backfill_days ?? 90));
  const [stale, setStale] = useState(String(s.stale_after_hours ?? 26));
  const [max, setMax] = useState(String(s.max_media_per_sync ?? DEFAULTS.sync.max_media_per_sync));
  return (
    <Card title="Getting new posts" subtitle="How often the dashboard checks your accounts for new posts and numbers.">
      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Check every (hours)" hint="Takes effect after the app is restarted."><input className={inputCls} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <Field label="First connection reads back (days)" hint="How much history to load when an account is first connected."><input className={inputCls} inputMode="numeric" value={back} onChange={(e) => setBack(e.target.value)} /></Field>
        <Field label="Mark data as old after (hours)" hint="Shows a warning when the last check is older than this."><input className={inputCls} inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} /></Field>
      </div>
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-ink-2">More</summary>
        <div className="mt-3 max-w-xs"><Field label="Most posts to read per check" hint="A safety limit. 500 is plenty."><input className={inputCls} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></Field></div>
      </details>
      <SaveBar onSave={async () => {
        const h = toNum(hours), b = toNum(back), st = toNum(stale), m = toNum(max);
        if (!inRange(h, 1, 168)) throw new Error('"Check every" must be between 1 and 168 hours.');
        if (!inRange(b, 7, 365, true)) throw new Error('"First connection reads back" must be a whole number of days between 7 and 365.');
        if (!inRange(st, 1, 336, true)) throw new Error('"Mark data as old after" must be a whole number of hours between 1 and 336.');
        if (!inRange(m, 50, 2000, true)) throw new Error('"Most posts to read" must be a whole number between 50 and 2000.');
        await put('sync', { ...s, interval_minutes: Math.round(h * 60), backfill_days: b, stale_after_hours: st, max_media_per_sync: m });
        reload();
      }} />
    </Card>
  );
}

function AnalysisForm({ data, reload }: { data: any; reload: () => void }) {
  const a = data.analysis ?? {};
  const init = { ...DEFAULTS.analysis, ...a };
  const [v, setV] = useState({ pre: String(init.min_sample_preliminary), mod: String(init.min_sample_moderate), strong: String(init.min_sample_strong), alpha: String(init.alpha), boot: String(init.bootstrap_iterations) });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const D = DEFAULTS.analysis;
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">How sure a finding must be</h3>
      <p className="text-xs text-ink-2 mt-0.5 mb-3">The analysis labels a finding "early signal", "fairly sure" or "strong" depending on how many videos it is based on.</p>
      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Videos for an early signal"><input className={inputCls} inputMode="numeric" value={v.pre} onChange={set('pre')} /></Field>
        <Field label="Videos for a fairly sure finding"><input className={inputCls} inputMode="numeric" value={v.mod} onChange={set('mod')} /></Field>
        <Field label="Videos for a strong finding"><input className={inputCls} inputMode="numeric" value={v.strong} onChange={set('strong')} /></Field>
        <Field label="How strict the test is" hint="Smaller is stricter. 0.05 is the usual choice."><input className={inputCls} inputMode="decimal" value={v.alpha} onChange={set('alpha')} /></Field>
        <Field label="Repeat calculations" hint="More is steadier but slower. 2000 is good."><input className={inputCls} inputMode="numeric" value={v.boot} onChange={set('boot')} /></Field>
      </div>
      <SaveBar
        extra={<button className="text-xs underline text-ink-2 hover:text-ink" onClick={() => setV({ pre: String(D.min_sample_preliminary), mod: String(D.min_sample_moderate), strong: String(D.min_sample_strong), alpha: String(D.alpha), boot: String(D.bootstrap_iterations) })}>Reset to recommended (then save)</button>}
        onSave={async () => {
          const pre = toNum(v.pre), mod = toNum(v.mod), strong = toNum(v.strong), alpha = toNum(v.alpha), boot = toNum(v.boot);
          if (![pre, mod, strong].every((n) => inRange(n, 2, 100, true))) throw new Error('The video counts must be whole numbers between 2 and 100.');
          if (!(pre <= mod && mod <= strong)) throw new Error('The counts must go up: early signal ≤ fairly sure ≤ strong.');
          if (!inRange(alpha, 0.001, 0.2)) throw new Error('"How strict the test is" must be between 0.001 and 0.2.');
          if (!inRange(boot, 200, 10000, true)) throw new Error('"Repeat calculations" must be a whole number between 200 and 10000.');
          await put('analysis', { ...a, min_sample_preliminary: pre, min_sample_moderate: mod, min_sample_strong: strong, alpha, bootstrap_iterations: boot });
          reload();
        }} />
    </div>
  );
}

const parts = (x: string | number) => String(x);
function SegmentsForm({ templates, reload }: { templates: any[] | null; reload: () => void }) {
  const t = templates?.find((x) => x.is_default);
  const [rows, setRows] = useState<{ code: string; label: string; start: string; end: string }[]>([]);
  useEffect(() => { if (t) setRows(t.segments.map((s: any) => ({ code: s.code, label: s.label, start: parts(s.start), end: parts(s.end) }))); }, [t?.id]);
  if (!t) return null;
  const upd = (i: number, k: 'start' | 'end', val: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const parse = (s: string): number | string => { const x = s.trim(); if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x); if (/^-?\d+(\.\d+)?%$/.test(x)) return x; throw new Error(`"${s}" is not a valid time. Use seconds (3), a percent of the video (40%), or from the end (-15%).`); };
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">How each video is cut into parts for analysis</h3>
      <p className="text-xs text-ink-2 mt-0.5 mb-3">The analysis compares like with like, for example opening with opening. Use seconds (3), a percent of the video (40%) or counting from the end (-15%). Parts are fitted to each video's real length.</p>
      <table className="text-sm w-full max-w-md">
        <thead><tr className="text-left text-xs text-ink-2"><th className="py-1 pr-3 font-medium">Part</th><th className="py-1 pr-3 font-medium">From</th><th className="py-1 font-medium">To</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.code}><td className="py-1 pr-3 text-ink">{r.label}</td>
            <td className="py-1 pr-3"><input className={`${inputCls} !py-1`} value={r.start} onChange={(e) => upd(i, 'start', e.target.value)} /></td>
            <td className="py-1"><input className={`${inputCls} !py-1`} value={r.end} onChange={(e) => upd(i, 'end', e.target.value)} /></td></tr>))}
        </tbody>
      </table>
      <SaveBar label="Save parts" onSave={async () => {
        const segments = rows.map((r) => ({ code: r.code, label: r.label, start: parse(r.start), end: parse(r.end) }));
        await api(`/api/segment-templates/${t.id}`, { method: 'PUT', body: { segments } });
        reload();
      }} />
      <p className="text-xs text-ink-3 mt-2">After changing the parts, run the video analysis and the findings again so comparisons use the new boundaries.</p>
    </div>
  );
}
