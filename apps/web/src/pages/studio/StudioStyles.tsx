import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import StudioMusic from './StudioMusic';
import StylePreview from './StylePreview';
import { api, can, useApi } from '../../lib';
import { useMe } from '../../main';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, PageHeader } from '../../components/ui';
import { uploadFiles } from './common';

/** Editing styles (the nine presets and styles learned from reference videos) and the music library, as two tabs. */
export default function StudioStyles() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'music' ? 'music' : 'styles';
  return (
    <>
      <PageHeader title="Styles & music" subtitle="The looks Claude can edit in, styles copied from videos you like, and the licensed music" />
      <div className="flex gap-1 border-b border-stone-200 mb-5 text-sm">
        {[['styles', 'Editing styles'], ['music', 'Music library']].map(([k, l]) => (
          <button key={k} onClick={() => setParams(k === 'music' ? { tab: 'music' } : {})} className={`px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>))}
      </div>
      {tab === 'music' ? <StudioMusic embedded /> : <Styles />}
    </>
  );
}

export function PresetCard({ s, onOpen, selected, compact }: { s: any; onOpen: () => void; selected?: boolean; compact?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className={`w-full h-full text-left bg-white border rounded-xl overflow-hidden transition flex flex-col ${selected ? 'border-ink ring-2 ring-ink/20' : 'border-stone-200 hover:border-stone-400'}`}>
      <StylePreview styleKey={s.key} className="rounded-none" />
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
        <StylePreview styleKey={s.key} className="mt-4 border border-stone-200" />
        <div className="text-[11px] text-ink-3 mt-1">A sample in this style, drawn live in your browser. Your video follows your own topic.</div>
        <div className="grid sm:grid-cols-2 gap-5 mt-4 text-sm">
          <div><div className="text-[11px] uppercase tracking-wider font-semibold text-ink-3 mb-1">What it looks like</div><div className="text-ink-2">{s.looks}</div></div>
          <div><div className="text-[11px] uppercase tracking-wider font-semibold text-ink-3 mb-1">Best for</div><div className="text-ink-2">{s.best_for}</div></div>
        </div>
        {s.good_to_know && <div className="mt-4 border border-red-300 bg-red-50/40 rounded-lg p-3 text-sm"><div className="text-[11px] uppercase tracking-wider font-semibold text-red-800 mb-1">Good to know</div><div className="text-ink-2">{s.good_to_know}</div></div>}
        <div className="text-xs text-ink-3 mt-3">Example topic: <i>{s.example_topic}</i></div>
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
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const anyBusy = (data ?? []).some((r) => r.status === 'analysing');
  useEffect(() => { if (!anyBusy) return; const t = setTimeout(reload, 4000); return () => clearTimeout(t); }, [anyBusy, data]);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');
  const presets = data.filter((s) => s.group === 'preset');
  const refs = data.filter((s) => s.group === 'reference');

  const add = async () => {
    if (!file) return;
    setErr(null); setBusy(true);
    try { await uploadFiles('/api/studio/styles', [file], { name, notes }, setProgress); setFile(null); setName(''); setNotes(''); reload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-ink">Preset styles</h2>
        <span className="text-xs text-ink-3">Click a style to see it move. Each video is made in one style.</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {presets.map((s) => <PresetCard key={s.key} s={s} onOpen={() => setOpen(s)} />)}
      </div>
      {open && <PresetDetail s={open} onClose={() => setOpen(null)} action={manage && <Button variant="primary" onClick={() => nav(`/studio/new?style=${open.key}`)}>Make a video in this style →</Button>} />}

      <h2 className="text-base font-semibold text-ink mb-3">Styles from your reference videos</h2>
      <div className="grid lg:grid-cols-3 gap-5">
        <Card title="Copy the style of a video you like" subtitle="Upload an edit you like (a reel, a Short, an ad). Claude copies its style: pacing, how graphics come in, captions, colour and sound. Never its footage or music.">
          {manage ? (
            <>
              <label className="block border-2 border-dashed border-stone-300 rounded-xl p-5 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 40)); }} />
                <div className="text-sm font-medium">{file ? file.name : 'Choose a reference video'}</div>
                <div className="text-xs text-ink-3 mt-1">MP4 or MOV, up to a few minutes</div>
              </label>
              <div className="mt-3 space-y-3">
                <Field label="Style name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tharun explainer" /></Field>
                <Field label="What do you like about it? (optional)" hint="Claude reads this with the video"><textarea className={`${inputCls} h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="The way 3D objects rise behind the speaker, the fast captions" /></Field>
              </div>
              <ErrorBox error={err} />
              <div className="mt-3"><Button variant="primary" disabled={!file || busy} onClick={add}>{busy ? `Uploading ${Math.round(progress * 100)}%` : 'Save this style'}</Button></div>
              <div className="text-[11px] text-ink-3 mt-3 leading-relaxed">The video is kept in Google Drive › _assets › style_references so Claude can watch it. The studio also measures it (how often it cuts, share of full-screen graphics, colour, caption position, sound) and those numbers go into the prompt.</div>
            </>
          ) : <Empty>Only an Admin can add styles.</Empty>}
        </Card>
        <Card title={`Your reference styles (${refs.length})`} className="lg:col-span-2">
          {!refs.length ? <Empty>None yet. Upload a reference video on the left.</Empty> : (
            <div className="space-y-4">
              {refs.map((r) => <RefStyle key={r.key} r={r} manage={manage} onChanged={reload} onUse={() => nav(`/studio/new?style=${encodeURIComponent(r.key)}`)} />)}
            </div>)}
        </Card>
      </div>
    </>
  );
}

function RefStyle({ r, manage, onChanged, onUse }: { r: any; manage: boolean; onChanged: () => void; onUse: () => void }) {
  const [edit, setEdit] = useState(false);
  const [notes, setNotes] = useState(r.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border border-stone-200 rounded-xl p-4 flex gap-4">
      <video src={`/api/studio/styles/${r.id}/video`} className="w-28 aspect-[9/16] bg-black rounded-lg object-cover shrink-0" muted controls preload="metadata" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-ink">{r.name}</span>
          {r.status === 'analysing' ? <Badge color="blue">Measuring…</Badge> : r.status === 'failed' ? <Badge color="red">Failed</Badge> : <Badge color="green">Ready</Badge>}
          {r.drive_link && <a className="text-xs underline text-ink-2" href={r.drive_link} target="_blank" rel="noreferrer">In Drive</a>}</div>
        <div className="text-[11px] text-ink-3">from {r.source}</div>
        {r.about && <div className="text-ink-2 mt-1">{r.about}</div>}
        {(r.report ?? []).length > 0 && <ul className="text-xs text-ink-2 mt-2 space-y-0.5">{r.report.map((l: string) => <li key={l}>• {l}</li>)}</ul>}
        {r.error && <div className="text-xs text-amber-800 mt-1">{r.error}</div>}
        {!edit ? (r.notes ? <div className="text-xs text-ink-2 mt-2"><span className="text-ink-3">What we like: </span>{r.notes}</div> : null) : (
          <div className="mt-2 space-y-1">
            <textarea className={`${inputCls} h-16 text-xs`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <ErrorBox error={err} />
            <div className="flex gap-2"><Button small variant="primary" onClick={async () => { try { await api(`/api/studio/styles/${r.id}`, { method: 'PATCH', body: { notes } }); setEdit(false); onChanged(); } catch (e) { setErr((e as Error).message); } }}>Save</Button><Button small onClick={() => setEdit(false)}>Cancel</Button></div>
          </div>)}
        {manage && !edit && <div className="mt-3 flex flex-wrap gap-2">
          <Button small variant="primary" disabled={r.status === 'analysing'} onClick={onUse}>Make a video in this style</Button>
          <Button small onClick={() => setEdit(true)}>{r.notes ? 'Edit notes' : 'Add notes'}</Button>
          <Button small variant="danger" onClick={async () => { if (!confirm(`Delete the style "${r.name}"?`)) return; try { await api(`/api/studio/styles/${r.id}`, { method: 'DELETE' }); onChanged(); } catch (e) { alert((e as Error).message); } }}>Delete</Button>
        </div>}
      </div>
    </div>
  );
}
