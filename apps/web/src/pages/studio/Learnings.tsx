import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, PLATFORM_NAMES, useApi, useOrigin, withOrigin } from '../../lib';
import { Badge, CertaintyBadge } from '../../components/ui';
import { copyText } from './common';

const STYLE_TONE: Record<string, string> = {
  good: 'bg-emerald-50 border-emerald-200 text-emerald-900', weak: 'bg-amber-50 border-amber-200 text-amber-900',
  untested: 'bg-stone-50 border-stone-200 text-ink-2', neutral: 'bg-stone-50 border-stone-200 text-ink-2',
};

/**
 * Top of New video: what past videos teach for this one (chosen style and platforms), strongest first.
 * "Copy for Claude" copies the same list the prompt on the next page already contains, to paste into a chat that is already open.
 */
export function LearningsBox({ style, platforms }: { style: string | null; platforms: string[] }) {
  const origin = useOrigin();
  const q = `/api/studio/learnings?style=${encodeURIComponent(style ?? '')}&platforms=${platforms.join(',')}`;
  const { data, error } = useApi<any>(withOrigin(q, origin), [origin, style, platforms.join(',')]);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);
  if (error) return null;
  const items: any[] = data?.items ?? [];
  const shown = all ? items : items.slice(0, 3);
  const copy = async () => { if (!data?.prompt_text) return; await copyText(data.prompt_text); setCopied(true); setTimeout(() => setCopied(false), 3000); };
  return (
    <section className="bg-white border border-stone-200 rounded-xl p-5 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink flex items-center gap-2">Learnings from your past videos {origin === 'demo' && <Badge color="amber">DEMO DATA</Badge>}</h2>
          <p className="text-xs text-ink-2 mt-0.5">{data ? (data.videos_analysed ? `What worked in your ${data.videos_analysed} published videos${data.updated_at ? ` · analysis updated ${fmt.ago(data.updated_at)}` : ''}. Strongest first.` : 'What worked in your published videos.') : 'Loading…'}</p>
        </div>
        {data?.prompt_text && (
          <button onClick={copy} className="inline-flex items-center gap-2 bg-ink text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-stone-800" title="Copies the editing lessons as text for Claude">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            {copied ? 'Copied ✓' : 'Copy for Claude'}</button>)}
      </div>

      {data?.style && <div className={`mt-3 border rounded-lg px-3 py-2 text-sm ${STYLE_TONE[data.style.verdict]}`}><b>{data.style.name}:</b> {data.style.text}</div>}

      {data && !items.length && <div className="mt-3 text-sm text-ink-3">{data.empty_reason}</div>}
      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100">
          {shown.map((i) => (
            <li key={i.insight_id + i.text} className="py-2.5 flex gap-3">
              <span className={`shrink-0 w-14 text-center text-[11px] font-semibold rounded-md py-0.5 h-fit ${i.kind === 'do' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>{i.kind === 'do' ? 'DO' : 'AVOID'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink leading-snug">{i.platforms?.length ? <span className="text-ink-2">{i.platforms.map((p: string) => PLATFORM_NAMES[p] ?? p).join(' & ')}: </span> : null}{i.text}</div>
                <div className="text-xs text-ink-2 mt-0.5">Why: {i.why}.</div>
                <div className="flex flex-wrap gap-2 items-center mt-1"><CertaintyBadge c={i.certainty} />{!i.for_claude && <span className="text-[11px] text-ink-3">for planning — not in the prompt</span>}</div>
              </div>
            </li>))}
        </ul>)}
      <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs">
        {items.length > 3 ? <button className="text-ink-2 hover:text-ink font-medium" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button> : <span />}
        <span className="text-ink-3">The prompt on the next page already includes these. <Link to="/insights" className="underline">All findings</Link></span>
      </div>
    </section>
  );
}
