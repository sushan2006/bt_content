import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApi } from '../../lib';
import { Button, Card, ErrorBox, Field, inputCls, PageHeader } from '../../components/ui';
import { listInput, StylePicker, uploadFiles } from './common';

const PLATFORMS = [{ k: 'instagram', l: 'Instagram Reel' }, { k: 'facebook', l: 'Facebook Reel' }, { k: 'youtube', l: 'YouTube Short' }];
type NewMachine = { name: string; notes: string; photos: File[] };
const blankMachine = (): NewMachine => ({ name: '', notes: '', photos: [] });

export default function StudioNew() {
  const nav = useNavigate();
  const settings = useApi<any>('/api/studio/settings').data;
  const music = useApi<any[]>('/api/studio/music').data ?? [];
  const styles = useApi<any[]>('/api/studio/styles').data ?? [];
  const saved = (useApi<any[]>('/api/studio/machines').data ?? []).filter((m) => m.status === 'ready');
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? (settings?.variants ?? ['editorial', 'hype', 'cinematic', 'minimal']);
  const [f, setF] = useState<any>({ title: '', headline: '', speaker_name: '', speaker_role: '', cta: '', keywords: '', hashtags: '', script: '', notes: '', music: '', publish_at: '', skip: false, landscape: false });
  const [platforms, setPlatforms] = useState<string[]>(['instagram', 'facebook', 'youtube']);
  const [takes, setTakes] = useState<File[]>([]);
  const [images, setImages] = useState<{ file: File; tags: string }[]>([]);
  // machines shown in 3D: ones added for earlier videos, and new ones built from photos now
  const [hasMachine, setHasMachine] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [machines, setMachines] = useState<NewMachine[]>([blankMachine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setMachine = (i: number, patch: Partial<NewMachine>) => setMachines(machines.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const filled = machines.filter((m) => m.name.trim() || m.photos.length);

  const submit = async () => {
    setErr(null);
    if (!f.title.trim()) return setErr('Give the video a working title.');
    if (!takes.length) return setErr('Add at least one take.');
    if (!chosen.length) return setErr('Pick at least one editing style.');
    if (hasMachine) {
      const bad = filled.findIndex((m) => !m.name.trim() || !m.photos.length);
      if (bad >= 0) return setErr(`Machine ${bad + 1}: give it a name and add at least one photo.`);
      if (!filled.length && !savedIds.length) return setErr('Add a machine (name + photos), pick one you added before, or untick "This video shows a machine".');
    }
    try {
      const machineIds = hasMachine ? [...savedIds] : [];
      if (hasMachine) {
        for (const [i, m] of filled.entries()) {
          setBusy(`Uploading photos of machine ${i + 1} (${m.name})`);
          const fd = new FormData();
          fd.append('name', m.name.trim()); fd.append('notes', m.notes);
          m.photos.forEach((p) => fd.append('photo', p));
          machineIds.push((await api<any>('/api/studio/machines', { form: fd })).id);
        }
      }
      setBusy('Creating the video');
      const brief: any = { headline: f.headline || undefined, speaker_name: f.speaker_name || undefined, speaker_role: f.speaker_role || undefined, cta: f.cta || undefined,
        keywords: listInput(f.keywords), hashtags: listInput(f.hashtags).map((h: string) => h.replace(/^#/, '')), script: f.script || undefined, notes: f.notes || undefined,
        skip_suggestions: f.skip || undefined, youtube_landscape: f.landscape || undefined };
      const job = await api<any>('/api/studio/jobs', { body: { title: f.title, brief, platforms, music_track_id: f.music || null, publish_at: f.publish_at ? new Date(f.publish_at).toISOString() : null, styles: chosen, machine_ids: machineIds } });
      setBusy('Uploading the takes');
      await uploadFiles(`/api/studio/jobs/${job.id}/files`, takes, {}, setProgress);
      for (const im of images) {
        setBusy(`Uploading ${im.file.name}`);
        await uploadFiles(`/api/studio/jobs/${job.id}/files`, [im.file], { tags: im.tags });
      }
      setBusy('Starting');
      await api(`/api/studio/jobs/${job.id}/start`, { method: 'POST' });
      nav(`/studio/${job.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  return (
    <>
      <PageHeader title="New video" subtitle="Upload the takes, add what the editor should know, and the studio does the rest" />
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card title="1. Footage" subtitle="2–3 takes of the same content work best. The studio picks the best take for every sentence.">
            <label className="block border-2 border-dashed border-stone-300 rounded-xl p-6 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
              <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => setTakes([...takes, ...Array.from(e.target.files ?? [])].slice(0, 6))} />
              <div className="text-sm text-ink font-medium">Choose video takes</div>
              <div className="text-xs text-ink-3 mt-1">MP4, MOV… up to 6 takes</div>
            </label>
            {takes.length > 0 && <ul className="mt-3 space-y-1">{takes.map((t, i) => (
              <li key={i} className="flex items-center justify-between text-sm bg-white border border-stone-200 rounded-lg px-3 py-2">
                <span><b>T{i + 1}</b> · {t.name} <span className="text-ink-3">({(t.size / 1e6).toFixed(1)} MB)</span></span>
                <button className="text-xs text-ink-3 hover:text-red-700" onClick={() => setTakes(takes.filter((_, k) => k !== i))}>remove</button>
              </li>))}</ul>}
            <div className="mt-5">
              <div className="text-xs font-medium text-ink-2 mb-1">Pictures (optional): product photos, screenshots, diagrams</div>
              <label className="inline-flex"><input type="file" accept="image/*" multiple className="text-xs" onChange={(e) => setImages([...images, ...Array.from(e.target.files ?? []).map((file) => ({ file, tags: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ', ') }))])} /></label>
              {images.map((im, i) => (
                <div key={i} className="flex items-center gap-2 mt-2">
                  <img src={URL.createObjectURL(im.file)} className="w-12 h-12 object-cover rounded" />
                  <input className={inputCls} value={im.tags} placeholder="words that bring this picture on screen, e.g. sensor, product" onChange={(e) => setImages(images.map((x, k) => (k === i ? { ...x, tags: e.target.value } : x)))} />
                  <button className="text-xs text-ink-3" onClick={() => setImages(images.filter((_, k) => k !== i))}>✕</button>
                </div>))}
              <div className="text-[11px] text-ink-3 mt-1">A picture appears when one of its words is spoken. Add the word <b>product</b> to the main product shot.</div>
            </div>
          </Card>

          <Card title="2. Machines (optional)" subtitle="Your own machines appear in 3D when you talk about them">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={hasMachine} onChange={(e) => setHasMachine(e.target.checked)} />This video shows one of our machines
            </label>
            {hasMachine && (
              <div className="mt-4 space-y-4">
                {machines.map((m, i) => (
                  <div key={i} className="border border-stone-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-ink">Machine {i + 1}</div>
                      {machines.length > 1 && <button className="text-xs text-ink-3 hover:text-red-700" onClick={() => setMachines(machines.filter((_, k) => k !== i))}>remove</button>}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Name" hint="Say this name in the video to bring it on screen"><input className={inputCls} value={m.name} onChange={(e) => setMachine(i, { name: e.target.value })} placeholder="e.g. TankSync controller" /></Field>
                      <Field label="What should the 3D model show? (optional)"><input className={inputCls} value={m.notes} onChange={(e) => setMachine(i, { notes: e.target.value })} placeholder="Size, important parts, what moves" /></Field>
                    </div>
                    <label className="mt-3 block border-2 border-dashed border-stone-300 rounded-xl p-4 text-center cursor-pointer hover:border-stone-400 bg-stone-50">
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setMachine(i, { photos: [...m.photos, ...Array.from(e.target.files ?? [])].slice(0, 6) })} />
                      <div className="text-sm font-medium">Upload photos ({m.photos.length}/6)</div>
                      <div className="text-[11px] text-ink-3">Front first, then side and top. A plain background gives the cleanest 3D model.</div>
                    </label>
                    {m.photos.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{m.photos.map((p, k) => (
                      <div key={k} className="relative"><img src={URL.createObjectURL(p)} className="w-14 h-14 object-cover rounded" />
                        <button className="absolute -top-1 -right-1 bg-white border rounded-full w-5 h-5 text-[10px]" onClick={() => setMachine(i, { photos: m.photos.filter((_, x) => x !== k) })}>✕</button></div>))}</div>}
                  </div>
                ))}
                <Button small onClick={() => setMachines([...machines, blankMachine()])}>+ Add another machine</Button>
                {saved.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-ink-2 mb-1">Or use machines added for earlier videos</div>
                    <div className="flex flex-wrap gap-2">{saved.map((m) => {
                      const on = savedIds.includes(m.id);
                      return (
                        <label key={m.id} className={`flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg border cursor-pointer ${on ? 'border-ink bg-stone-50' : 'border-stone-200'}`}>
                          <input type="checkbox" checked={on} onChange={(e) => setSavedIds(e.target.checked ? [...savedIds, m.id] : savedIds.filter((x) => x !== m.id))} />{m.name}
                        </label>);
                    })}</div>
                  </div>
                )}
                <div className="text-[11px] text-ink-3">Each machine is turned into a 3D model (.glb) from its photos before the edit starts, and kept for later videos. With a Claude API key Claude models it in full 3D; without one, a 3D relief of the photo is used.</div>
              </div>
            )}
          </Card>

          <Card title="3. Brief" subtitle="Everything is optional except the title. Plain words are fine.">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Working title"><input className={inputCls} value={f.title} onChange={set('title')} placeholder="Sensor launch explainer" /></Field>
              <Field label="Headline on screen (first seconds)"><input className={inputCls} value={f.headline} onChange={set('headline')} placeholder="Your machines are talking. Are you listening?" /></Field>
              <Field label="Speaker name"><input className={inputCls} value={f.speaker_name} onChange={set('speaker_name')} /></Field>
              <Field label="Speaker role"><input className={inputCls} value={f.speaker_role} onChange={set('speaker_role')} placeholder="Product Lead" /></Field>
              <Field label="Call to action" hint={`Default: ${settings?.brand?.cta ?? 'Follow for more'}`}><input className={inputCls} value={f.cta} onChange={set('cta')} placeholder="Follow for more" /></Field>
              <Field label="Words to highlight" hint="Comma separated: product names, key terms"><input className={inputCls} value={f.keywords} onChange={set('keywords')} /></Field>
              <Field label="Hashtags"><input className={inputCls} value={f.hashtags} onChange={set('hashtags')} placeholder="IoT, Industry40" /></Field>
              <Field label="Publish at (optional)"><input type="datetime-local" className={inputCls} value={f.publish_at} onChange={set('publish_at')} /></Field>
            </div>
            <div className="mt-4"><Field label="Script (optional)" hint="If you paste the script, takes are matched against it line by line."><textarea className={`${inputCls} h-28`} value={f.script} onChange={set('script')} /></Field></div>
            <div className="mt-4"><Field label="Notes for the editor"><textarea className={`${inputCls} h-20`} value={f.notes} onChange={set('notes')} placeholder="e.g. keep it under 45 seconds, show the dashboard screenshot when we talk about alerts" /></Field></div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="4. Editing styles" subtitle="One version is made in each style you pick. The approver chooses one.">
            <StylePicker styles={styles} value={chosen} onChange={setPicked} />
            <div className="text-[11px] text-ink-3 mt-1">Add a style from a video you like in <Link className="underline" to="/studio/styles">Styles &amp; music</Link>.</div>
          </Card>
          <Card title="Where it goes">
            {PLATFORMS.map((p) => (
              <label key={p.k} className="flex items-center gap-2 text-sm py-1"><input type="checkbox" checked={platforms.includes(p.k)} onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p.k] : platforms.filter((x) => x !== p.k))} />{p.l}</label>))}
            <label className="flex items-center gap-2 text-sm py-1 mt-2"><input type="checkbox" checked={f.landscape} onChange={set('landscape')} />Also a landscape YouTube video (landscape footage only)</label>
          </Card>
          <Card title="Music" subtitle="Licensed tracks only. Without one, an original music bed made by the studio is used.">
            <select className={inputCls} value={f.music} onChange={set('music')}>
              <option value="">No music</option>
              {music.filter((m) => m.is_active && !m.content_id_registered && m.license_path).map((m) => <option key={m.id} value={m.id}>{m.title}{m.artist ? ` – ${m.artist}` : ''} ({m.source.replace(/_/g, ' ')})</option>)}
            </select>
            <div className="text-[11px] text-ink-3 mt-1">Add tracks with their licence in <Link className="underline" to="/studio/styles?tab=music">Styles &amp; music</Link>.</div>
          </Card>
          <Card title="Suggestions">
            <div className="text-sm text-ink-2">{settings?.review_mode === 'email'
              ? (settings?.suggestion_emails?.length ? <>The studio will email <b>{settings.suggestion_emails.join(', ')}</b> for suggestions and wait up to {settings.suggestion_wait_hours} h.</> : 'No one is on the suggestions list (Studio settings), so editing starts straight away.')
              : Number(settings?.suggestion_window_hours ?? 0) > 0 ? <>Colleagues can add suggestions on the video's page for {settings.suggestion_window_hours} h before the edit starts.</> : 'Editing starts straight away. Colleagues can still ask for changes when they review.'}</div>
            <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={f.skip} onChange={set('skip')} />Skip suggestions for this video</label>
          </Card>
          <ErrorBox error={err} />
          <Button variant="primary" disabled={!!busy} onClick={submit}>{busy ? `${busy}${busy.startsWith('Uploading the takes') ? ` ${Math.round(progress * 100)}%` : '…'}` : 'Create and start editing'}</Button>
        </div>
      </div>
    </>
  );
}
