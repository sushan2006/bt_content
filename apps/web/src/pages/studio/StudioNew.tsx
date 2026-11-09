import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, useApi } from '../../lib';
import { Button, Card, ErrorBox, Field, inputCls, PageHeader } from '../../components/ui';
import { PresetCard, PresetDetail } from './StudioStyles';
import { fmtLength, KIND, listInput, PLATFORMS, uploadFiles } from './common';
import { LearningsBox } from './Learnings';

const LENGTHS = [15, 30, 45, 60, 90, 120];
type NewMachine = { name: string; notes: string; photos: File[] };

/** Set up a video: what it is about, the style, the material, length, format and audio. The video page then gives the prompt. */
export default function StudioNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const settings = useApi<any>('/api/studio/settings').data;
  const styles = useApi<any[]>('/api/studio/styles').data ?? [];
  const music = (useApi<any[]>('/api/studio/music').data ?? []).filter((m) => m.is_active && !m.content_id_registered && m.license_path);
  const savedMachines = useApi<any[]>('/api/studio/machines').data ?? [];
  const presets = styles.filter((s) => s.group === 'preset');

  const [style, setStyle] = useState<string | null>(params.get('style'));
  const [detail, setDetail] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'footage' | 'voiceover' | 'animation'>('footage');
  const [takes, setTakes] = useState<File[]>([]);
  const [voice, setVoice] = useState<File | null>(null);
  const [storyboard, setStoryboard] = useState<boolean | null>(null);
  const [len, setLen] = useState<{ on: boolean; min: number; sec: number }>({ on: true, min: 0, sec: 30 });
  const [format, setFormat] = useState<'9:16' | '16:9'>('9:16');
  const [withMusic, setWithMusic] = useState(true);
  const [track, setTrack] = useState('');
  const [sfx, setSfx] = useState(true);
  const [subtitles, setSubtitles] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook', 'youtube']);
  const [more, setMore] = useState(false);
  const [f, setF] = useState<any>({ headline: '', speaker_name: '', speaker_role: '', cta: '', keywords: '', spellings: '', hashtags: '', script: '', notes: '' });
  const [images, setImages] = useState<{ file: File; tags: string }[]>([]);
  const [machineIds, setMachineIds] = useState<string[]>([]);
  const [newMachines, setNewMachines] = useState<NewMachine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // defaults from Studio settings
  useEffect(() => {
    if (!settings) return;
    setStyle((s) => s ?? settings.default_style ?? 'paper_cutout');
    setFormat(settings.default_format ?? '9:16');
    const d = Number(settings.default_length_sec ?? 30);
    setLen({ on: true, min: Math.floor(d / 60), sec: d % 60 });
    if (settings.default_platforms?.length) setPlatforms(settings.default_platforms);
  }, [settings]);

  const chosen = useMemo(() => styles.find((s) => s.key === style) ?? null, [styles, style]);
  const sb = storyboard ?? !!chosen?.storyboard_first;
  const footageOnly = !!chosen?.footage_only;
  // a style can set its own sound defaults (Simple Edit: no added music or effects); footage-only styles need camera footage
  const pick = (key: string) => {
    setStyle(key); setStoryboard(null);
    const s = styles.find((x) => x.key === key);
    if (s?.defaults) { if (s.defaults.music !== undefined) setWithMusic(s.defaults.music); if (s.defaults.sfx !== undefined) setSfx(s.defaults.sfx); if (s.defaults.subtitles !== undefined) setSubtitles(s.defaults.subtitles); }
    if (s?.footage_only) setKind('footage');
  };
  const lengthSec = len.on ? Math.max(5, len.min * 60 + len.sec) : null;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    setErr(null);
    if (!style) return setErr('Pick a style.');
    if (!title.trim()) return setErr('Give the video a title.');
    if (!topic.trim()) return setErr('Write what the video is about.');
    if (!platforms.length) return setErr('Pick at least one platform.');
    if (footageOnly && kind !== 'footage') return setErr(`${chosen?.name} edits camera footage: choose Camera footage.`);
    const badM = newMachines.findIndex((m) => !m.name.trim() || !m.photos.length);
    if (badM >= 0) return setErr(`Machine ${badM + 1}: give it a name and at least one photo, or remove it.`);
    try {
      const ids = [...machineIds];
      for (const [i, m] of newMachines.entries()) {
        setBusy(`Saving machine ${i + 1} (${m.name})`);
        const fd = new FormData();
        fd.append('name', m.name.trim()); fd.append('notes', m.notes);
        m.photos.forEach((p) => fd.append('photo', p));
        ids.push((await api<any>('/api/studio/machines', { form: fd })).id);
      }
      setBusy('Creating the video');
      const brief: any = { topic: topic.trim(), headline: f.headline || undefined, speaker_name: f.speaker_name || undefined, speaker_role: f.speaker_role || undefined,
        cta: f.cta || undefined, keywords: listInput(f.keywords), hashtags: listInput(f.hashtags).map((h: string) => h.replace(/^#/, '')), spellings: f.spellings || undefined,
        script: f.script || undefined, notes: f.notes || undefined };
      const job = await api<any>('/api/studio/jobs', { body: { title: title.trim(), brief, kind, style,
        options: { length_sec: kind === 'voiceover' ? null : lengthSec, format, storyboard: sb, music: withMusic, sfx, subtitles },
        platforms, music_track_id: withMusic && track ? track : null, machine_ids: ids } });
      if (kind === 'footage' && takes.length) { setBusy('Uploading the takes'); await uploadFiles(`/api/studio/jobs/${job.id}/files`, takes, {}, setProgress); }
      if (kind === 'voiceover' && voice) { setBusy('Uploading the voiceover'); await uploadFiles(`/api/studio/jobs/${job.id}/files`, [voice], {}, setProgress); }
      for (const im of images) { setBusy(`Uploading ${im.file.name}`); await uploadFiles(`/api/studio/jobs/${job.id}/files`, [im.file], { tags: im.tags }); }
      nav(`/studio/${job.id}?new=1`);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  return (
    <>
      <PageHeader title="New video" subtitle="Pick a look, describe the topic, choose the format. You get the prompt for Claude Code on the next page." />
      <LearningsBox style={style} platforms={platforms} />
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card title="1. Pick a style" subtitle="Click a style to select it. ⓘ shows it moving with what it is best for.">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {presets.map((s) => (
                <div key={s.key} className="relative">
                  <PresetCard s={s} compact selected={style === s.key} onOpen={() => pick(s.key)} />
                  <button type="button" title="See this style" onClick={() => setDetail(s)} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 border border-stone-300 text-xs font-semibold text-ink-2 hover:text-ink">i</button>
                </div>))}
            </div>
          </Card>
          {detail && <PresetDetail s={detail} onClose={() => setDetail(null)} action={<Button variant="primary" onClick={() => { pick(detail.key); setDetail(null); }}>Use this style</Button>} />}

          <Card title="2. What is the video about?">
            <div className="space-y-3">
              <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How the water motor works" /></Field>
              <Field label="What the video should explain"><textarea className={`${inputCls} h-24`} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="This video explains how the water motor works and its principle" /></Field>
              {chosen?.example_topic && !topic && <button type="button" className="text-xs underline text-ink-2" onClick={() => setTopic(chosen.example_topic)}>Use this style's example topic</button>}
            </div>
          </Card>

          <Card title="3. What will you give Claude?">
            <div className="grid sm:grid-cols-3 gap-2">
              {(Object.keys(KIND) as (keyof typeof KIND)[]).filter((k) => !footageOnly || k === 'footage').map((k) => (
                <label key={k} className={`border rounded-xl p-3 cursor-pointer text-sm ${kind === k ? 'border-ink bg-stone-50' : 'border-stone-200 hover:border-stone-400'}`}>
                  <div className="flex items-center gap-2 font-medium"><input type="radio" checked={kind === k} onChange={() => setKind(k as any)} />{KIND[k].label}</div>
                  <div className="text-[11px] text-ink-3 mt-1 leading-snug">{footageOnly ? 'I recorded the footage; Claude cuts it into a clean video, no graphics' : KIND[k].about}</div>
                </label>))}
            </div>
            {kind === 'footage' && (
              <div className="mt-4">
                <label className="block border-2 border-dashed border-stone-300 rounded-xl p-5 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
                  <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => setTakes([...takes, ...Array.from(e.target.files ?? [])].slice(0, 8))} />
                  <div className="text-sm text-ink font-medium">Upload the takes (optional)</div>
                  <div className="text-xs text-ink-3 mt-1">They are kept in Google Drive and linked in the prompt. You can also just attach them in Claude.</div>
                </label>
                {takes.length > 0 && <ul className="mt-2 space-y-1">{takes.map((t, i) => (
                  <li key={i} className="flex items-center justify-between text-sm bg-white border border-stone-200 rounded-lg px-3 py-1.5">
                    <span><b>T{i + 1}</b> · {t.name} <span className="text-ink-3">({(t.size / 1e6).toFixed(1)} MB)</span></span>
                    <button className="text-xs text-ink-3 hover:text-red-700" onClick={() => setTakes(takes.filter((_, k) => k !== i))}>remove</button></li>))}</ul>}
              </div>)}
            {kind === 'voiceover' && (
              <div className="mt-4">
                <label className="block border-2 border-dashed border-stone-300 rounded-xl p-5 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => setVoice(e.target.files?.[0] ?? null)} />
                  <div className="text-sm text-ink font-medium">{voice ? voice.name : 'Upload the voiceover MP3 (optional)'}</div>
                  <div className="text-xs text-ink-3 mt-1">Or attach it in Claude. The video's length follows the voiceover.</div>
                </label>
              </div>)}
          </Card>

          <Card title="4. Length, format and sound">
            <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-1" checked={sb} onChange={(e) => setStoryboard(e.target.checked)} />
              <span><span className="font-medium">Storyboard first</span><span className="block text-ink-3 text-xs">Claude shows you still frames of every scene and waits for your OK before animating{chosen?.storyboard_first ? ' (recommended for this style)' : ''}</span></span></label>

            {kind !== 'voiceover' && (
              <div className="mt-4 border border-dashed border-stone-300 rounded-xl p-4">
                <div className="text-sm font-medium text-ink mb-2">How long should it be?</div>
                {kind === 'footage' && <label className="flex items-center gap-2 text-xs text-ink-2 mb-2"><input type="checkbox" checked={!len.on} onChange={(e) => setLen({ ...len, on: !e.target.checked })} />As long as the footage needs</label>}
                {len.on && <>
                  <div className="flex items-center gap-2 text-sm">
                    <input type="number" min={0} max={30} className={`${inputCls} !w-20`} value={len.min} onChange={(e) => setLen({ ...len, min: Math.max(0, Number(e.target.value) || 0) })} /> min
                    <input type="number" min={0} max={59} className={`${inputCls} !w-20`} value={len.sec} onChange={(e) => setLen({ ...len, sec: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} /> sec
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">{LENGTHS.map((s) => (
                    <button key={s} type="button" onClick={() => setLen({ on: true, min: Math.floor(s / 60), sec: s % 60 })}
                      className={`px-3 py-1 rounded-full border text-xs font-mono ${lengthSec === s ? 'bg-ink text-white border-ink' : 'border-stone-300 hover:border-stone-500'}`}>{s < 60 ? `${s}s` : fmtLength(s)}</button>))}</div>
                </>}
              </div>)}

            <div className="mt-4 text-sm font-medium text-ink mb-2">Format</div>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              {([['16:9', 'Horizontal 16:9', '1920 × 1080'], ['9:16', 'Vertical 9:16', '1080 × 1920']] as const).map(([k, l, d]) => (
                <button key={k} type="button" onClick={() => setFormat(k)} className={`flex items-center gap-3 border rounded-xl p-3 text-left ${format === k ? 'border-ink bg-stone-50' : 'border-stone-200 hover:border-stone-400'}`}>
                  <span className={`border-2 border-ink rounded-sm shrink-0 ${k === '9:16' ? 'w-5 h-8' : 'w-8 h-5'}`} />
                  <span><span className="block text-sm font-medium">{l}</span><span className="block text-[11px] text-ink-3 font-mono">{d}</span></span>
                </button>))}
            </div>

            <div className="mt-4 text-sm font-medium text-ink mb-1">Audio</div>
            <label className="flex items-center gap-2 text-sm py-1"><input type="checkbox" checked={withMusic} onChange={(e) => setWithMusic(e.target.checked)} />Background music</label>
            {withMusic && (
              <div className="ml-6 max-w-md">
                <select className={inputCls} value={track} onChange={(e) => setTrack(e.target.value)}>
                  <option value="">Original music made by Claude (no licence needed)</option>
                  {music.map((m) => <option key={m.id} value={m.id}>{m.title}{m.artist ? ` – ${m.artist}` : ''} ({m.source.replace(/_/g, ' ')})</option>)}
                </select>
                <div className="text-[11px] text-ink-3 mt-1">Licensed tracks are added in <Link className="underline" to="/studio/styles?tab=music">Styles &amp; music</Link>.</div>
              </div>)}
            <label className="flex items-center gap-2 text-sm py-1"><input type="checkbox" checked={sfx} onChange={(e) => setSfx(e.target.checked)} />Sound effects</label>
            <label className="flex items-start gap-2 text-sm py-1"><input type="checkbox" className="mt-1" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
              <span>Subtitles burnt into the video<span className="block text-ink-3 text-xs">{footageOnly ? 'Off keeps the video clean: picture and sound only' : 'Word-by-word captions of the speech'}</span></span></label>
          </Card>

          <Card title="5. More details (optional)" actions={<Button small variant="ghost" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'}</Button>}>
            {!more ? <div className="text-sm text-ink-3">Headline, speaker, call to action, spellings, script, pictures and machines.</div> : (
              <div className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Headline in the first seconds"><input className={inputCls} value={f.headline} onChange={set('headline')} placeholder="Your machines are talking. Are you listening?" /></Field>
                  <Field label="Call to action" hint={`Default: ${settings?.brand?.cta || 'Follow for more'}`}><input className={inputCls} value={f.cta} onChange={set('cta')} /></Field>
                  <Field label="Speaker name"><input className={inputCls} value={f.speaker_name} onChange={set('speaker_name')} /></Field>
                  <Field label="Speaker role"><input className={inputCls} value={f.speaker_role} onChange={set('speaker_role')} placeholder="Product Lead" /></Field>
                  <Field label="Key terms to spell right and highlight" hint="Comma separated"><input className={inputCls} value={f.keywords} onChange={set('keywords')} placeholder="TankSync, impeller" /></Field>
                  <Field label="Spelling fixes" hint="heard=correct, e.g. Beastings=BridgeThings"><input className={inputCls} value={f.spellings} onChange={set('spellings')} /></Field>
                  <Field label="Hashtags"><input className={inputCls} value={f.hashtags} onChange={set('hashtags')} placeholder="IoT, Industry40" /></Field>
                </div>
                <Field label="Script (optional)" hint="If the takes were recorded from a script, paste it: captions and line matching follow it."><textarea className={`${inputCls} h-24`} value={f.script} onChange={set('script')} /></Field>
                <Field label="Notes for Claude"><textarea className={`${inputCls} h-20`} value={f.notes} onChange={set('notes')} placeholder="e.g. show the dashboard screenshot when we talk about alerts" /></Field>
                <div>
                  <div className="text-xs font-medium text-ink-2 mb-1">Pictures: product photos, screenshots, diagrams</div>
                  <input type="file" accept="image/*" multiple className="text-xs" onChange={(e) => setImages([...images, ...Array.from(e.target.files ?? []).map((file) => ({ file, tags: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ', ') }))])} />
                  {images.map((im, i) => (
                    <div key={i} className="flex items-center gap-2 mt-2">
                      <img src={URL.createObjectURL(im.file)} className="w-12 h-12 object-cover rounded" alt="" />
                      <input className={inputCls} value={im.tags} placeholder="words that bring this picture on screen" onChange={(e) => setImages(images.map((x, k) => (k === i ? { ...x, tags: e.target.value } : x)))} />
                      <button className="text-xs text-ink-3" onClick={() => setImages(images.filter((_, k) => k !== i))}>✕</button>
                    </div>))}
                </div>
                <div>
                  <div className="text-xs font-medium text-ink-2 mb-1">Our machines in this video (Claude draws them from their photos)</div>
                  {savedMachines.length > 0 && <div className="flex flex-wrap gap-2 mb-2">{savedMachines.map((m) => {
                    const on = machineIds.includes(m.id);
                    return <label key={m.id} className={`flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg border cursor-pointer ${on ? 'border-ink bg-stone-50' : 'border-stone-200'}`}>
                      <input type="checkbox" checked={on} onChange={(e) => setMachineIds(e.target.checked ? [...machineIds, m.id] : machineIds.filter((x) => x !== m.id))} />{m.name}</label>;
                  })}</div>}
                  {newMachines.map((m, i) => (
                    <div key={i} className="border border-stone-200 rounded-xl p-3 mb-2">
                      <div className="grid sm:grid-cols-2 gap-2">
                        <input className={inputCls} value={m.name} placeholder="Machine name, e.g. TankSync controller" onChange={(e) => setNewMachines(newMachines.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                        <input className={inputCls} value={m.notes} placeholder="Important parts, what moves" onChange={(e) => setNewMachines(newMachines.map((x, k) => (k === i ? { ...x, notes: e.target.value } : x)))} />
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <input type="file" accept="image/*" multiple className="text-xs" onChange={(e) => setNewMachines(newMachines.map((x, k) => (k === i ? { ...x, photos: [...x.photos, ...Array.from(e.target.files ?? [])].slice(0, 8) } : x)))} />
                        <span className="text-xs text-ink-3">{m.photos.length} photo(s)</span>
                        <button className="text-xs text-ink-3 hover:text-red-700 ml-auto" onClick={() => setNewMachines(newMachines.filter((_, k) => k !== i))}>remove</button>
                      </div>
                    </div>))}
                  <Button small onClick={() => setNewMachines([...newMachines, { name: '', notes: '', photos: [] }])}>+ Add a machine</Button>
                </div>
              </div>)}
          </Card>
        </div>

        <div className="space-y-5">
          <div className="lg:sticky lg:top-4 space-y-5">
            <Card title="Your video">
              <div className="text-sm space-y-1.5">
                <Row k="Style" v={chosen?.name ?? '—'} />
                <Row k="Material" v={KIND[kind].label} />
                <Row k="Length" v={kind === 'voiceover' ? 'Follows the voiceover' : fmtLength(lengthSec)} />
                <Row k="Format" v={format === '9:16' ? '1080 × 1920' : '1920 × 1080'} />
                <Row k="Storyboard first" v={sb ? 'Yes' : 'No'} />
                <Row k="Music" v={withMusic ? (track ? music.find((m) => m.id === track)?.title ?? 'Licensed track' : 'Original') : 'None'} />
                <Row k="Sound effects" v={sfx ? 'Yes' : 'No'} />
                <Row k="Subtitles" v={subtitles ? 'Yes' : 'No'} />
                <Row k="Thumbnail" v="Made by Claude, or picked later" />
              </div>
              <div className="mt-3 text-xs font-medium text-ink-2">Where it will be posted</div>
              {PLATFORMS.map((p) => (
                <label key={p.k} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" checked={platforms.includes(p.k)} onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p.k] : platforms.filter((x) => x !== p.k))} />{p.l}</label>))}
            </Card>
            <ErrorBox error={err} />
            <Button variant="primary" disabled={!!busy} onClick={submit}>{busy ? `${busy}${busy.startsWith('Uploading the') ? ` ${Math.round(progress * 100)}%` : '…'}` : 'Create video and get the prompt →'}</Button>
            <div className="text-[11px] text-ink-3 leading-relaxed">Next: copy the prompt, paste it into a new Claude Code chat in this project and attach the footage. When you are happy with the edit, put the video in <b>content_final</b> and it appears under Completed.</div>
          </div>
        </div>
      </div>
    </>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-3"><span className="text-ink-3">{k}</span><span className="text-ink text-right">{v}</span></div>;
