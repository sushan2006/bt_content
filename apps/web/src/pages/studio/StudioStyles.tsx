import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import StudioMusic from './StudioMusic';
import { api, can, useApi } from '../../lib';
import { useMe } from '../../main';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, PageHeader } from '../../components/ui';
import { uploadFiles } from './common';

const LOOK: Record<string, string[]> = {
  editorial: ['Cuts to full-screen 3D explainers while you keep talking', '3D machines rise from behind you', 'Kinetic captions, key words large', 'Soft air whooshes only'],
  hype: ['Framing changes every ~2 s', 'Zoom pulses and small shakes on key words', 'Big boxed captions, word by word', 'Black statement cards for numbers'],
  cinematic: ['Letterbox bars, teal-orange film grade, grain', 'Chapter cards that dip to black', 'Slow push-ins, 3D explainers kept', 'Subtle sentence captions, ambient music'],
  minimal: ['Cuts only on sentences', 'Soft-box captions at the bottom', 'Clean white number cards and a name card', 'Almost no sound effects'],
};

/** Editing styles and the music library on one page, as two tabs. */
export default function StudioStyles() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'music' ? 'music' : 'styles';
  return (
    <>
      <PageHeader title="Styles & music" subtitle="How the videos look and sound: the editing styles to choose from, and the licensed music they can use" />
      <div className="flex gap-1 border-b border-stone-200 mb-5 text-sm">
        {[['styles', 'Editing styles'], ['music', 'Music library']].map(([k, l]) => (
          <button key={k} onClick={() => setParams(k === 'music' ? { tab: 'music' } : {})} className={`px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>))}
      </div>
      {tab === 'music' ? <StudioMusic embedded /> : <Styles />}
    </>
  );
}

function Styles() {
  const me = useMe();
  const { data, reload } = useApi<any[]>('/api/studio/styles');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');
  const builtins = data.filter((s) => s.group === 'style');
  const refs = data.filter((s) => s.group === 'reference');
  const anyBusy = refs.some((r) => r.status === 'analysing');
  if (anyBusy) setTimeout(reload, 4000);

  const add = async () => {
    if (!file) return;
    setErr(null); setBusy(true);
    try { await uploadFiles('/api/studio/styles', [file], { name }, setProgress); setFile(null); setName(''); reload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <p className="text-sm text-ink-2 mb-4">Every video can be made in several styles at once. Add your own by showing the studio a video you like.</p>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {builtins.map((s) => (
          <Card key={s.key} title={s.name}>
            <div className="text-xs text-ink-2 mb-2">{s.about}</div>
            <ul className="text-xs text-ink-2 space-y-1">{(LOOK[s.key] ?? []).map((l) => <li key={l}>• {l}</li>)}</ul>
          </Card>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <Card title="Learn a style from a reference video" subtitle="Upload an edit you like (an Instagram reel, a YouTube Short…). The studio measures how it is cut and turns it into a style.">
          {manage ? (
            <>
              <label className="block border-2 border-dashed border-stone-300 rounded-xl p-5 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
                <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 40)); }} />
                <div className="text-sm font-medium">{file ? file.name : 'Choose a reference video'}</div>
                <div className="text-xs text-ink-3 mt-1">MP4 or MOV, up to a few minutes</div>
              </label>
              <div className="mt-3"><Field label="Style name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tharun explainer" /></Field></div>
              <ErrorBox error={err} />
              <Button variant="primary" disabled={!file || busy} onClick={add}>{busy ? `Uploading ${Math.round(progress * 100)}%` : 'Learn this style'}</Button>
              <div className="text-[11px] text-ink-3 mt-3 leading-relaxed">With a Claude API key, Claude also watches the video and writes a <b>style card</b> (pacing, graphics, captions, colour, sound, do's and don'ts) that it follows whenever this style is chosen. It measures: how often it cuts, how much of it is full-screen graphics and whether they are light or dark, the colour grade and letterbox, where the captions sit and their highlight colour, how many sound effects there are and how loud the music is. The closest built-in style is used as the base, with those numbers applied.</div>
            </>
          ) : <Empty>You need the studio.manage permission to add styles.</Empty>}
        </Card>
        <Card title="Styles learned from your videos" className="lg:col-span-2">
          {!refs.length ? <Empty>None yet. Upload a reference video on the left.</Empty> : (
            <div className="space-y-4">
              {refs.map((r) => (
                <div key={r.key} className="border border-stone-200 rounded-xl p-4 flex gap-4">
                  <video src={`/api/studio/styles/${r.id}/video`} className="w-28 aspect-[9/16] bg-black rounded-lg object-cover shrink-0" muted controls preload="metadata" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="font-semibold text-ink">{r.name}</span>
                      {r.status === 'ready' ? <Badge color="green">Ready</Badge> : r.status === 'failed' ? <Badge color="red">Failed</Badge> : <Badge color="blue">Analysing…</Badge>}
                      {r.base_name && <span className="text-xs text-ink-3">based on {r.base_name}</span>}</div>
                    <div className="text-[11px] text-ink-3">from {r.source}</div>
                    {r.error && <div className="text-xs text-red-700 mt-1">{r.error}</div>}
                    {r.card ? <StyleCard r={r} manage={manage} onSaved={reload} />
                      : (r.report ?? []).length > 0 && <ul className="text-xs text-ink-2 mt-2 space-y-0.5">{r.report.map((l: string) => <li key={l}>• {l}</li>)}</ul>}
                    {manage && <div className="mt-2 flex gap-2">
                      <select className="text-xs border border-stone-300 rounded px-1 py-0.5" value={r.base} onChange={async (e) => { await api(`/api/studio/styles/${r.id}`, { method: 'PATCH', body: { base: e.target.value } }); reload(); }}>
                        <option value="explainer3d">Base: 3D Explainer</option><option value="hype">Base: Bold & Fast</option><option value="cinematic">Base: Cinematic Story</option><option value="minimal">Base: Clean & Minimal</option>
                      </select>
                      <Button small variant="danger" onClick={async () => { if (confirm(`Delete the style "${r.name}"?`)) { await api(`/api/studio/styles/${r.id}`, { method: 'DELETE' }); reload(); } }}>Delete</Button>
                    </div>}
                  </div>
                </div>))}
            </div>)}
          <div className="text-[11px] text-ink-3 mt-3">Pick these styles when you create a video, or make them the default in Studio settings.</div>
        </Card>
      </div>
    </>
  );
}

function StyleCard({ r, manage, onSaved }: { r: any; manage: boolean; onSaved: () => void }) {
  const c = r.card ?? {};
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const row = (label: string, v: any) => v ? <div className="text-xs"><span className="text-ink-3">{label}: </span><span className="text-ink-2">{v}</span></div> : null;
  return (
    <div className="mt-2 bg-violet-50/60 border border-violet-100 rounded-lg p-3 space-y-1">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-violet-900">Style card written by Claude</div>
      {c.summary && <div className="text-sm text-ink">{c.summary}</div>}
      {row('Pacing', [c.pacing?.cut_every ? `a cut every ${c.pacing.cut_every} s` : null, c.pacing?.notes].filter(Boolean).join(' · '))}
      {row('Transitions', [c.transitions?.into_graphics, c.transitions?.engine_in ? `engine: ${c.transitions.engine_in} in / ${c.transitions.engine_out ?? 'cut'} out` : null].filter(Boolean).join(' · '))}
      {row('Motion graphics', [c.motion_graphics?.how_they_enter, (c.motion_graphics?.signature_effects ?? []).join(', ')].filter(Boolean).join(' · '))}
      {row('Graphics', [c.graphics?.look, c.graphics?.motion].filter(Boolean).join(' · '))}
      {row('Captions', [c.captions?.mode, c.captions?.notes].filter(Boolean).join(' · '))}
      {row('Look', [c.look?.grade?.replace('_', '-'), c.look?.notes].filter(Boolean).join(' · '))}
      {row('Sound', [c.sound?.music, c.sound?.sfx].filter(Boolean).join(' · '))}
      {(c.replicate ?? []).length > 0 && <div className="text-xs text-ink-2"><span className="text-ink-3">Claude will: </span>{c.replicate.join(' · ')}</div>}
      {(c.do ?? []).length > 0 && <div className="text-xs text-emerald-800">Do: {c.do.join(' · ')}</div>}
      {(c.dont ?? []).length > 0 && <div className="text-xs text-red-800">Don't: {c.dont.join(' · ')}</div>}
      {manage && !edit && <button className="text-[11px] underline text-ink-2" onClick={() => { setText(JSON.stringify(c, null, 2)); setEdit(true); }}>Edit the style card</button>}
      {edit && <div className="space-y-1">
        <textarea className="w-full h-64 font-mono text-[11px] border border-stone-300 rounded p-2" value={text} onChange={(e) => setText(e.target.value)} />
        {err && <div className="text-xs text-red-700">{err}</div>}
        <div className="flex gap-2"><Button small variant="primary" onClick={async () => { try { await api(`/api/studio/styles/${r.id}`, { method: 'PATCH', body: { card: JSON.parse(text) } }); setEdit(false); onSaved(); } catch (e) { setErr((e as Error).message); } }}>Save</Button>
          <Button small onClick={() => setEdit(false)}>Cancel</Button></div>
      </div>}
    </div>);
}
