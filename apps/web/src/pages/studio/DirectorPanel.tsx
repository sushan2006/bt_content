import { useState } from 'react';
import { Badge } from '../../components/ui';

/** Right-hand panel on a job: what Claude (or the automatic editor) is doing right now, step by step. */
export function DirectorPanel({ job, versions, assets }: { job: any; versions: any[]; assets: any[] }) {
  const d = job.director ?? {};
  const [showLog, setShowLog] = useState(false);
  const rev = job.revision;
  const progress: any[] = (d.progress ?? []).filter((p: any) => (p.revision ?? rev) === rev);
  const major = progress.filter((p) => p.major);
  const minor = progress.filter((p) => !p.major);
  const status = job.status;
  const planning = d.planner === 'claude' && !d.finished_at && ['planning', 'analyzing'].includes(status);
  const cur = versions.filter((v) => v.revision === rev && v.aspect === '9:16');

  type Step = { label: string; state: 'done' | 'active' | 'todo' | 'failed'; sub?: string };
  const steps: Step[] = [];
  const order = ['new', 'waiting_suggestions', 'analyzing', 'planning', 'rendering', 'in_review', 'approved', 'publishing', 'published'];
  const at = order.indexOf(status);
  const past = (s: string) => at > order.indexOf(s) || ['approved', 'publishing', 'published'].includes(status);
  steps.push({ label: 'Footage received', state: at >= 1 || status === 'failed' ? 'done' : 'active' });
  steps.push({ label: 'Best takes chosen, words transcribed', state: past('analyzing') ? 'done' : status === 'analyzing' ? 'active' : 'todo' });
  if (d.planner === 'claude') {
    major.forEach((m, i) => {
      const last = i === major.length - 1;
      steps.push({ label: m.text, state: last && planning ? 'active' : 'done' });
    });
    if (!major.length) steps.push({ label: 'Claude plans the edit', state: status === 'planning' ? 'active' : past('planning') ? 'done' : 'todo' });
    if (d.error) steps.push({ label: `Claude stopped: ${d.error}`, state: 'failed', sub: 'the automatic edit was used instead' });
  } else {
    steps.push({ label: 'Edit planned by the automatic rules', state: past('planning') ? 'done' : status === 'planning' ? 'active' : 'todo',
      sub: d.why ? `Claude is off: ${d.why}` : undefined });
  }
  const rendered = cur.filter((v) => v.status === 'ready').length;
  steps.push({ label: `Rendering ${cur.length || ''} versions on this computer`.replace('  ', ' '), state: past('rendering') ? 'done' : status === 'rendering' ? 'active' : 'todo',
    sub: status === 'rendering' ? `${rendered} of ${cur.length} ready · ${job.status_detail ?? ''}` : undefined });
  steps.push({ label: 'Ready for review in the dashboard', state: past('in_review') ? 'done' : status === 'in_review' ? 'active' : 'todo' });
  if (status === 'failed') steps.push({ label: 'Needs attention', state: 'failed', sub: job.error ?? undefined });

  const dot = (s: Step['state']) => s === 'done' ? <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center">✓</span>
    : s === 'active' ? <span className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      : s === 'failed' ? <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">!</span>
        : <span className="w-4 h-4 rounded-full border-2 border-stone-300" />;
  const research = d.research;
  const usage = d.usage;

  return (
    <aside className="space-y-4 lg:sticky lg:top-4">
      <section className="bg-white border border-stone-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-ink">Progress</h2>
          {d.planner === 'claude' ? <Badge color="violet">Claude director</Badge> : <Badge>Automatic editor</Badge>}
        </div>
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 items-start">
              <span className="mt-0.5 shrink-0">{dot(s.state)}</span>
              <span className="min-w-0">
                <span className={`block text-[13px] leading-snug ${s.state === 'todo' ? 'text-ink-3' : s.state === 'failed' ? 'text-red-700' : 'text-ink'}`}>{s.label}</span>
                {s.sub && <span className="block text-[11px] text-ink-3 leading-snug mt-0.5 break-words">{s.sub}</span>}
              </span>
            </li>))}
        </ol>
        {minor.length > 0 && (
          <div className="mt-3 border-t border-stone-100 pt-2">
            <button className="text-[11px] text-ink-2 underline" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide details' : `Show what Claude did (${minor.length})`}</button>
            {(showLog ? minor : minor.slice(-3)).map((m, i) => <div key={i} className="text-[11px] text-ink-3 leading-snug mt-1 break-words">{m.text}</div>)}
          </div>)}
        {usage && (
          <div className="mt-3 border-t border-stone-100 pt-2 text-[11px] text-ink-2 flex flex-wrap gap-x-3 gap-y-1">
            <span>Claude cost <b>${(usage.cost_usd ?? 0).toFixed(2)}</b>{d.usage_total && d.usage_total !== usage.cost_usd ? ` (all revisions $${Number(d.usage_total).toFixed(2)})` : ''}</span>
            <span>{Math.round(((usage.input ?? 0) + (usage.cache_read ?? 0) + (usage.cache_write ?? 0)) / 1000)}k tokens read · {Math.round((usage.output ?? 0) / 1000)}k written</span>
            {usage.searches ? <span>{usage.searches} web searches</span> : null}
            {usage.budget_usd ? <span>budget ${Number(usage.budget_usd).toFixed(2)}</span> : null}
          </div>)}
      </section>

      {research && (research.summary || (research.facts ?? []).length > 0) && (
        <section className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="text-[15px] font-semibold text-ink mb-1">Research notes</h2>
          <p className="text-[11px] text-ink-3 mb-2">What Claude checked on the web before editing. Please check the facts before approving.</p>
          {research.topic && <div className="text-[13px] font-medium text-ink">{research.topic}</div>}
          {research.summary && <p className="text-xs text-ink-2 mt-1 leading-relaxed">{research.summary}</p>}
          {(research.checks ?? []).length > 0 && <ul className="mt-2 space-y-1">{research.checks.slice(0, 6).map((c: any, i: number) => (
            <li key={i} className="text-[11px] leading-snug"><span className={c.verdict === 'correct' ? 'text-emerald-700' : c.verdict === 'wrong' ? 'text-red-700' : 'text-amber-700'}>
              {c.verdict === 'correct' ? '✓' : c.verdict === 'wrong' ? '✗' : '?'}</span> <span className="text-ink-2">{c.claim}</span>{c.note ? <span className="text-ink-3"> — {c.note}</span> : null}</li>))}</ul>}
          {(research.facts ?? []).length > 0 && <ul className="mt-2 space-y-1">{research.facts.slice(0, 8).map((f: any, i: number) => (
            <li key={i} className="text-[11px] text-ink-2 leading-snug">• {f.fact} {f.url ? <a className="underline text-ink-3" href={f.url} target="_blank" rel="noreferrer">{f.source || 'source'}</a> : f.source ? <span className="text-ink-3">({f.source})</span> : null}</li>))}</ul>}
        </section>)}

      {assets.length > 0 && (
        <section className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="text-[15px] font-semibold text-ink mb-1">3D models built for this video</h2>
          <p className="text-[11px] text-ink-3 mb-2">Saved to the asset library, reused by later videos. Download as .glb.</p>
          <div className="space-y-2">{assets.map((a) => (
            <div key={a.id} className="flex gap-2 items-center">
              {a.has_preview ? <img src={`/api/studio/assets/${a.id}/preview`} className="w-24 h-8 object-cover rounded bg-slate-800" /> : <span className="w-24 h-8 rounded bg-stone-100" />}
              <span className="min-w-0 text-xs"><b className="block truncate">{a.name}</b><span className="text-ink-3">{a.parts} parts · </span>{a.has_glb && <a className="underline text-ink-2" href={`/api/studio/assets/${a.id}/glb`}>.glb</a>}</span>
            </div>))}</div>
        </section>)}
    </aside>
  );
}
