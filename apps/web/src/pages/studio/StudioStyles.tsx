import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import StudioMusic from './StudioMusic';
import StylePreview from './StylePreview';
import { api, can, useApi } from '../../lib';
import { useMe } from '../../main';
import { Badge, Button, Card, Loading, PageHeader } from '../../components/ui';
import { uploadFiles } from './common';

/** Editing styles (the nine presets) and the music library, as two tabs. */
export default function StudioStyles() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'music' ? 'music' : 'styles';
  return (
    <>
      <PageHeader title="Styles & music" subtitle="The looks Claude can edit in (add your own as a style pack), and the licensed music" actions={tab === 'styles' ? <CopyKit /> : undefined} />
      <div className="flex gap-1 border-b border-stone-200 mb-5 text-sm">
        {[['styles', 'Editing styles'], ['music', 'Music library']].map(([k, l]) => (
          <button key={k} onClick={() => setParams(k === 'music' ? { tab: 'music' } : {})} className={`px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>))}
      </div>
      {tab === 'music' ? <StudioMusic embedded /> : <Styles />}
    </>
  );
}

/** Copies the Style Pack Kit (docs/STYLE_PACK_KIT.md) so it can be pasted into any Claude chat together with a video. Loaded only when clicked. */
function CopyKit() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      const text = (await import('../../../../../docs/STYLE_PACK_KIT.md?raw')).default;
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta);
        if (!ok) throw new Error('copy refused');
      }
      setState('copied');
    } catch { setState('failed'); }
    setTimeout(() => setState('idle'), 3000);
  };
  return (
    <div className="text-right">
      <Button onClick={copy} small>{state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Could not copy' : 'Copy Style Pack Kit'}</Button>
      <div className="text-[11px] text-ink-3 mt-1 max-w-[260px]">Paste it into any Claude chat together with a video to make a new style.</div>
    </div>
  );
}

/** The live preview of a built-in style, or the thumbnail picture of a style pack. */
function StyleThumb({ s, className = '' }: { s: any; className?: string }) {
  if (!s.thumbnail) return <StylePreview styleKey={s.key} className={className} />;
  return <div className={`aspect-video w-full overflow-hidden rounded-lg bg-stone-200 ${className}`}><img src={s.thumbnail} alt={`${s.name} sample`} className="w-full h-full object-cover" /></div>;
}

export function PresetCard({ s, onOpen, selected, compact }: { s: any; onOpen: () => void; selected?: boolean; compact?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className={`w-full h-full text-left bg-white border rounded-xl overflow-hidden transition flex flex-col ${selected ? 'border-ink ring-2 ring-ink/20' : 'border-stone-200 hover:border-stone-400'}`}>
      <StyleThumb s={s} className="rounded-none" />
      <div className={compact ? 'p-2.5' : 'p-4'}>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full border-2 border-ink text-xs font-semibold flex items-center justify-center shrink-0">{s.number}</span>
          <span className={`font-semibold text-ink truncate ${compact ? 'text-[13px]' : ''}`} title={s.name}>{s.name}</span>
          {selected && !compact && <Badge color="green">Chosen</Badge>}
        </div>
        {!compact && <div className="text-[11px] text-ink-3 mt-1 font-mono">{s.technique}</div>}
        <div className={`text-ink-2 mt-1 ${compact ? 'text-[11px] leading-snug' : 'text-sm'}`}>{compact ? s.tagline : s.about}</div>
      </div>
    </button>
  );
}

/** Everything about one preset: the sample, what it looks like, what it is best for. */
export function PresetDetail({ s, onClose, action }: { s: any; onClose: () => void; action?: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full border-2 border-ink font-semibold flex items-center justify-center shrink-0">{s.number}</span>
          <div className="flex-1 min-w-0"><div className="text-xl font-semibold text-ink">{s.name}</div><div className="text-xs text-ink-3 font-mono">{s.tagline} · {s.technique}</div></div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-xl leading-none px-2" aria-label="Close">✕</button>
        </div>
        <StyleThumb s={s} className="mt-4 border border-stone-200" />
        <div className="text-[11px] text-ink-3 mt-1">{s.thumbnail ? 'A sample picture of this style.' : 'A sample in this style, drawn live in your browser.'} Your video follows your own topic.</div>
        <div className="grid sm:grid-cols-2 gap-5 mt-4 text-sm">
          <div><div className="text-[11px] uppercase tracking-wider font-semibold text-ink-3 mb-1">What it looks like</div><div className="text-ink-2">{s.looks}</div></div>
          <div><div className="text-[11px] uppercase tracking-wider font-semibold text-ink-3 mb-1">Best for</div><div className="text-ink-2">{s.best_for}</div></div>
        </div>
        {s.good_to_know && <div className="mt-4 border border-red-300 bg-red-50/40 rounded-lg p-3 text-sm"><div className="text-[11px] uppercase tracking-wider font-semibold text-red-800 mb-1">Good to know</div><div className="text-ink-2">{s.good_to_know}</div></div>}
        <div className="text-xs text-ink-3 mt-3">Example topic: <i>{s.example_topic}</i></div>
        {s.readme && <details className="mt-4 text-sm"><summary className="cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-ink-3">About this style (README)</summary><div className="mt-2 whitespace-pre-wrap text-xs text-ink-2 max-h-56 overflow-auto border border-stone-200 rounded-lg p-3 bg-stone-50">{s.readme}</div></details>}
        {action && <div className="mt-5 flex justify-end gap-2">{action}</div>}
      </div>
    </div>
  );
}

function Styles() {
  const me = useMe();
  const nav = useNavigate();
  const { data, reload } = useApi<any[]>('/api/studio/styles');
  const [open, setOpen] = useState<any>(null);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');
  const presets = data.filter((s) => s.group === 'preset');

  return (
    <>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-ink">Preset styles</h2>
        <span className="text-xs text-ink-3">Click a style to see it move. Each video is made in one style.</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {presets.map((s) => <PresetCard key={s.key} s={s} onOpen={() => setOpen(s)} />)}
      </div>
      {open && <PresetDetail s={open} onClose={() => setOpen(null)} action={manage && <>
        {open.custom && <Button variant="danger" onClick={async () => { if (!confirm(`Delete the style "${open.name}"? Videos already made in it keep their files.`)) return; try { await api(`/api/studio/style-packs/${open.pack_id}`, { method: 'DELETE' }); setOpen(null); reload(); } catch (e) { alert((e as Error).message); } }}>Delete this style</Button>}
        <Button variant="primary" onClick={() => nav(`/studio/new?style=${open.key}`)}>Make a video in this style →</Button></>} />}
      {manage && <AddPack onAdded={reload} />}
    </>
  );
}

/** Adds a new style from a style pack: the files style.json, template.md, thumbnail.png and README.md picked together. */
function AddPack({ onAdded }: { onAdded: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pick = (list: FileList | null) => { setFiles(Array.from(list ?? []).filter((f) => /\.(json|md|png|jpe?g|webp|gif)$/i.test(f.name))); setErr(null); setDone(null); };
  const add = async () => {
    setErr(null); setDone(null); setBusy(true);
    try {
      const r = await uploadFiles('/api/studio/style-packs', files, {}, setProgress);
      setDone(`${r.created ? 'Added' : 'Updated'} "${r.name}". It is now in the list above and in New video.`);
      setFiles([]); onAdded();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const pickCls = 'inline-block border border-stone-300 rounded-lg px-3 py-1.5 text-sm cursor-pointer hover:border-stone-500 bg-white';
  return (
    <Card title="Add a style pack" subtitle="A new look, without changing any code. Ask Claude to make a style pack from a video you like, then add its folder here. It appears above with its picture and can be chosen for any new video.">
      <div className="flex flex-wrap items-center gap-3">
        <label className={pickCls}>Choose the pack folder
          <input type="file" className="hidden" onChange={(e) => pick(e.target.files)} {...({ webkitdirectory: '', directory: '' } as any)} />
        </label>
        <label className="text-xs underline text-ink-2 cursor-pointer">or choose the files
          <input type="file" multiple accept=".json,.md,.png,.jpg,.jpeg,.webp,.gif" className="hidden" onChange={(e) => pick(e.target.files)} />
        </label>
      </div>
      <div className="text-[11px] text-ink-3 mt-2">The pack has <b>style.json</b>, <b>template.md</b>, <b>thumbnail.png</b> and (optional) <b>README.md</b>. Adding a pack with the same name replaces the old one.</div>
      {files.length > 0 && <div className="mt-3 text-sm text-ink-2">Ready: {files.map((f) => f.name).join(', ')}</div>}
      {err && <div className="mt-3 text-sm text-red-700 whitespace-pre-line border border-red-200 bg-red-50 rounded-lg p-3">{err}</div>}
      {done && <div className="mt-3 text-sm text-green-800 border border-green-200 bg-green-50 rounded-lg p-3">{done}</div>}
      <div className="mt-3"><Button variant="primary" disabled={!files.length || busy} onClick={add}>{busy ? `Uploading ${Math.round(progress * 100)}%` : 'Add this style'}</Button></div>
    </Card>
  );
}
