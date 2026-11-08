import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, can, fmt, useApi } from '../../lib';
import { useMe } from '../../main';
import { Badge, Button, Card, Empty, ErrorBox, Field, inputCls, Loading, PageHeader, PlatformTag } from '../../components/ui';
import { copyText, fmtLength, fmtMB, KIND, OPEN, StatusBadge, THUMB_SOURCE, uploadFiles } from './common';
import { PostList, PublishForm } from './Publish';

const STEPS = ['Set up', 'Prompt copied', 'Finished video in content_final', 'Published'];
const stepOf = (s: string) => ({ prompt_ready: 0, with_claude: 1, completed: 2, publishing: 3, published: 4 } as Record<string, number>)[s] ?? 0;

export default function StudioJob() {
  const { id } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { data, error, reload } = useApi<any>(`/api/studio/jobs/${id}`, [id]);
  const busyPosts = (data?.publishing ?? []).some((p: any) => ['scheduled', 'uploading', 'processing'].includes(p.status));
  const waiting = data?.job && OPEN.includes(data.job.status);
  // refresh while something is happening elsewhere (Drive uploads, publishing, the finished video arriving)
  useEffect(() => { if (!busyPosts && !waiting) return; const t = setInterval(reload, busyPosts ? 5000 : 20000); return () => clearInterval(t); }, [busyPosts, waiting, reload]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { job, files, suggestions, publishing } = data;
  const manage = can(me, 'studio.manage');
  const step = stepOf(job.status);

  return (
    <>
      <PageHeader title={job.title} subtitle={<span className="flex items-center gap-2 flex-wrap"><span className="font-mono">{job.code}</span><StatusBadge s={job.status} />
        <span className="text-ink-3">{job.style_name} · {KIND[job.kind]?.label} · {job.options?.format === '16:9' ? '16:9' : '9:16'} · {job.kind === 'voiceover' ? 'length of the voiceover' : fmtLength(job.options?.length_sec)}</span></span>}
        actions={manage && <>
          {['cancelled', 'completed'].includes(job.status) && <Button onClick={async () => {
            if (job.status === 'completed' && !confirm('Send this video back to "Editing with Claude"? The current finished file is set aside; put the new one in content_final.')) return;
            try { await api(`/api/studio/jobs/${job.id}/reopen`, { method: 'POST' }); reload(); } catch (e) { alert((e as Error).message); } }}>{job.status === 'cancelled' ? 'Reopen' : 'Make changes'}</Button>}
          {!['publishing', 'published', 'cancelled'].includes(job.status) && <Button variant="danger" onClick={async () => { if (confirm(`Cancel ${job.code}?`)) { await api(`/api/studio/jobs/${job.id}`, { method: 'DELETE' }); nav('/studio'); } }}>Cancel video</Button>}
        </>} />

      {job.status !== 'cancelled' && (
        <ol className="flex items-center mb-6">{STEPS.map((s, i) => (
          <li key={s} className="flex-1 flex items-center min-w-0">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold border-2 shrink-0 ${i < step ? 'bg-emerald-600 border-emerald-600 text-white' : i === step ? 'border-ink text-ink' : 'border-stone-300 text-ink-3'}`}>{i < step ? '✓' : i + 1}</span>
            <span className={`text-xs ml-2 truncate ${i === step ? 'text-ink font-medium' : 'text-ink-3'}`}>{s}</span>
            {i < STEPS.length - 1 && <span className={`flex-1 h-0.5 mx-2 ${i < step ? 'bg-emerald-600' : 'bg-stone-200'}`} />}
          </li>))}</ol>)}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {OPEN.includes(job.status) && <PromptCard job={job} manage={manage} fresh={params.get('new') === '1'} onCopied={reload} suggestions={suggestions.length} />}
          <FinalCard job={job} manage={manage} onChange={reload} />
          {['completed', 'publishing', 'published'].includes(job.status) && (
            <Card title="Publish" subtitle="Write the captions, pick the platforms, publish now or schedule">
              <PostList posts={publishing} manage={manage} onChange={reload} />
              {manage && ['completed', 'published'].includes(job.status)
                ? <div className={publishing.length ? 'mt-4 pt-4 border-t border-stone-100' : ''}><PublishForm job={job} onDone={reload} /></div>
                : !manage && !publishing.length && <Empty>Only an Admin can publish.</Empty>}
            </Card>)}
        </div>
        <div className="space-y-5">
          <SetupCard job={job} manage={manage && OPEN.includes(job.status)} onSaved={reload} />
          <MaterialCard job={job} files={files} manage={manage && OPEN.includes(job.status)} onChange={reload} />
          <SuggestionsCard job={job} suggestions={suggestions} canAdd={can(me, 'studio.suggest', 'studio.manage') && OPEN.includes(job.status)} onAdded={reload} />
        </div>
      </div>
    </>
  );
}

function PromptCard({ job, manage, fresh, onCopied, suggestions }: { job: any; manage: boolean; fresh: boolean; onCopied: () => void; suggestions: number }) {
  const { data, reload } = useApi<any>(`/api/studio/jobs/${job.id}/prompt`, [job.id, suggestions, job.updated_at]);
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = async () => {
    setErr(null);
    try {
      const p = data?.prompt ?? (await api<any>(`/api/studio/jobs/${job.id}/prompt`)).prompt;
      await copyText(p);
      setDone(true); setTimeout(() => setDone(false), 4000);
      if (manage) { await api(`/api/studio/jobs/${job.id}/prompt/copied`, { method: 'POST' }); onCopied(); reload(); }
    } catch (e) { setErr((e as Error).message); setShow(true); }
  };
  return (
    <div className={`bg-white border-2 rounded-xl p-5 ${fresh && !job.prompt_copied_at ? 'border-ink' : 'border-stone-200'}`}>
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <div className="text-lg font-semibold text-ink">Prompt for Claude Code</div>
          <ol className="text-sm text-ink-2 mt-2 space-y-1 list-decimal ml-4">
            <li>Copy the prompt.</li>
            <li>Open a new Claude Code chat in the <b>content_bt</b> project and paste it.{job.kind === 'footage' ? ' Attach the takes (or let Claude download them from Drive).' : job.kind === 'voiceover' ? ' Attach the voiceover.' : ''}</li>
            <li>Work with Claude until you like the video.</li>
            <li>Put <code className="text-xs bg-stone-100 px-1 rounded">{job.expected_final_name}</code> (and the captions file) in <b>content_final</b>, or upload it below.</li>
          </ol>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button onClick={copy} disabled={!data} className="inline-flex items-center gap-2 bg-ink text-white rounded-lg px-5 py-3 font-semibold shadow-[3px_3px_0_#3b5bdb] hover:translate-y-px disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            {done ? 'Copied ✓' : 'Copy prompt'}</button>
          <span className="text-[11px] text-ink-3">{job.prompt_copied_at ? `Copied ${job.prompt_copies}× · last ${fmt.ago(job.prompt_copied_at)}` : 'Not copied yet'}</span>
        </div>
      </div>
      <ErrorBox error={err} />
      {suggestions > 0 && job.prompt_copied_at && <div className="text-xs text-violet-800 bg-violet-50 border border-violet-100 rounded-lg p-2 mt-3">The prompt always includes every suggestion. If suggestions came in after you copied it, copy it again and paste it into the same Claude chat.</div>}
      <button className="text-xs underline text-ink-2 mt-3" onClick={() => setShow(!show)}>{show ? 'Hide the prompt' : 'Show the prompt'}</button>
      {show && <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded-lg p-3 max-h-[28rem] overflow-y-auto select-all">{data?.prompt ?? 'Loading…'}</pre>}
    </div>
  );
}

function FinalCard({ job, manage, onChange }: { job: any; manage: boolean; onChange: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [captions, setCaptions] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  if (job.status === 'cancelled') return null;

  const changeThumb = async (f: File | null) => {
    if (!f) return;
    setErr(null); setMsg(null); setBusy('thumb');
    try { await uploadFiles(`/api/studio/jobs/${job.id}/thumbnail`, [f]); onChange(); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const frameThumb = async () => {
    setErr(null); setMsg(null); setBusy('frame');
    try { await api(`/api/studio/jobs/${job.id}/thumbnail/frame`, { body: { time: videoRef.current?.currentTime ?? null } }); onChange(); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  const upload = async () => {
    if (!file) return;
    setErr(null); setMsg(null); setBusy('upload');
    try {
      const fd: Record<string, string> = {};
      if (captions) fd.captions = await captions.text();
      await uploadFiles(`/api/studio/jobs/${job.id}/final`, [file], fd, setProgress);
      setFile(null); setCaptions(null); onChange();
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const scan = async () => {
    setErr(null); setMsg(null); setBusy('scan');
    try {
      const r = await api<any>('/api/studio/completed/scan', { method: 'POST' });
      if (r.error) setErr(r.error);
      else setMsg(r.linked?.includes(job.code) ? 'Found it.' : `Nothing for ${job.code} in content_final yet.`);
      onChange();
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  if (job.has_final) {
    const c = job.final_captions ?? {};
    return (
      <Card title="Finished video" subtitle={job.final_name} actions={<>
        {job.final_drive_link && <a className="text-xs underline text-ink-2 mr-3" href={job.final_drive_link} target="_blank" rel="noreferrer">Open in Drive</a>}
        <a className="text-xs underline text-ink-2" href={`/api/studio/jobs/${job.id}/final?download=1`}>Download</a></>}>
        <div className="grid sm:grid-cols-[minmax(0,14rem)_1fr] gap-4">
          <video ref={videoRef} src={`/api/studio/jobs/${job.id}/final`} poster={job.has_cover ? `/api/studio/jobs/${job.id}/thumbnail?v=${job.cover_v}` : undefined} controls preload="metadata" className={`w-full bg-black rounded-lg ${job.options?.format === '16:9' ? 'aspect-video' : 'aspect-[9/16]'}`} />
          <div className="text-sm space-y-2 min-w-0">
            <div className="flex gap-3 items-start bg-stone-50 border border-stone-200 rounded-lg p-3">
              {job.thumbnail_source ? <img src={`/api/studio/jobs/${job.id}/thumbnail?v=${job.cover_v}`} alt="Thumbnail" className="w-20 rounded border border-stone-200 bg-white shrink-0" />
                : <div className="w-20 h-20 rounded border border-dashed border-stone-300 text-[10px] text-ink-3 grid place-items-center text-center shrink-0">Making…</div>}
              <div className="text-xs space-y-1.5 min-w-0">
                <div className="font-semibold text-ink-2">Thumbnail</div>
                <div className="text-ink-3">{THUMB_SOURCE[job.thumbnail_source] ?? 'Being made from the video'}. It is used as the cover when the video is published.</div>
                {manage && <div className="flex flex-wrap gap-2 pt-0.5">
                  <label className="border border-stone-300 rounded-lg px-2 py-1 cursor-pointer hover:border-stone-500 bg-white"><input type="file" accept="image/*" className="hidden" onChange={(e) => changeThumb(e.target.files?.[0] ?? null)} />{busy === 'thumb' ? 'Uploading…' : 'Upload a picture'}</label>
                  <button className="border border-stone-300 rounded-lg px-2 py-1 hover:border-stone-500 bg-white" disabled={!!busy} onClick={frameThumb} title="Pause the video on the frame you want, then click">{busy === 'frame' ? 'Taking…' : 'Use the paused frame'}</button>
                </div>}
                {manage && <div className="text-[11px] text-ink-3">Or put <code>{job.expected_thumbnail_name}</code> in content_final.</div>}
              </div>
            </div>
            <div className="text-ink-2">{job.final_source === 'upload' ? 'Uploaded on this page' : 'Found in content_final'} {fmt.ago(job.completed_at)}{job.final_size ? ` · ${fmtMB(job.final_size)}` : ''}</div>
            {job.final_error && <div className="text-xs text-amber-800">{job.final_error}</div>}
            {job.final_captions ? (
              <div className="text-xs space-y-1.5 bg-stone-50 border border-stone-200 rounded-lg p-3">
                <div className="font-semibold text-ink-2">Captions from {job.code} captions.txt</div>
                {c.instagram && <div><span className="text-ink-3">Instagram: </span><span className="whitespace-pre-wrap">{c.instagram.slice(0, 220)}{c.instagram.length > 220 ? '…' : ''}</span></div>}
                {c.youtube_title && <div><span className="text-ink-3">YouTube title: </span>{c.youtube_title}</div>}
              </div>) : <div className="text-xs text-ink-3">No captions file yet. Write the captions when you publish.</div>}
            <ErrorBox error={err} />
          </div>
        </div>
      </Card>);
  }
  return (
    <Card title="Finished video" subtitle="Not in content_final yet">
      <div className="text-sm text-ink-2">When the edit is approved in Claude, put the video in <b>content_final</b> named <code className="text-xs bg-stone-100 px-1 rounded">{job.expected_final_name}</code> (and <code className="text-xs bg-stone-100 px-1 rounded">{job.expected_captions_name}</code>). The dashboard checks the folder every few minutes. Any name that starts with <b>{job.code}</b> works.</div>
      {manage && <div className="flex flex-wrap gap-2 mt-3 items-center">
        <Button small onClick={scan} disabled={!!busy}>{busy === 'scan' ? 'Checking…' : 'Check content_final now'}</Button>
        <span className="text-xs text-ink-3">or upload it here:</span>
        <label className="text-xs border border-stone-300 rounded-lg px-2 py-1 cursor-pointer hover:border-stone-500"><input type="file" accept="video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{file ? file.name : 'Choose the video'}</label>
        <label className="text-xs border border-stone-300 rounded-lg px-2 py-1 cursor-pointer hover:border-stone-500"><input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={(e) => setCaptions(e.target.files?.[0] ?? null)} />{captions ? captions.name : 'Captions .txt (optional)'}</label>
        {file && <Button small variant="primary" disabled={!!busy} onClick={upload}>{busy === 'upload' ? `Uploading ${Math.round(progress * 100)}%` : 'Upload to content_final'}</Button>}
      </div>}
      {msg && <div className="text-xs text-ink-2 mt-2">{msg}</div>}
      <ErrorBox error={err} />
    </Card>
  );
}

function SetupCard({ job, manage, onSaved }: { job: any; manage: boolean; onSaved: () => void }) {
  const styles = useApi<any[]>(manage ? '/api/studio/styles' : null).data ?? [];
  const [edit, setEdit] = useState(false);
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const b = job.brief ?? {}, o = job.options ?? {};
  const start = () => { setS({ title: job.title, topic: b.topic ?? '', notes: b.notes ?? '', style: job.style, length: o.length_sec ?? '', format: o.format ?? '9:16', storyboard: !!o.storyboard, music: o.music !== false, sfx: o.sfx !== false, subtitles: !!o.subtitles }); setEdit(true); };
  const save = async () => {
    setErr(null);
    try {
      await api(`/api/studio/jobs/${job.id}`, { method: 'PATCH', body: { title: s.title, style: s.style, brief: { topic: s.topic, notes: s.notes },
        options: { length_sec: s.length ? Number(s.length) : null, format: s.format, storyboard: s.storyboard, music: s.music, sfx: s.sfx, subtitles: s.subtitles } } });
      setEdit(false); onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  if (edit && s) return (
    <Card title="Set-up">
      <div className="space-y-3 text-sm">
        <Field label="Title"><input className={inputCls} value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
        <Field label="What it is about"><textarea className={`${inputCls} h-20`} value={s.topic} onChange={(e) => setS({ ...s, topic: e.target.value })} /></Field>
        <Field label="Style"><select className={inputCls} value={s.style} onChange={(e) => setS({ ...s, style: e.target.value })}>
          {styles.filter((x) => x.status === 'ready').map((x) => <option key={x.key} value={x.key}>{x.group === 'reference' ? `${x.name} (reference)` : x.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Length (seconds)"><input type="number" min={5} className={inputCls} value={s.length} placeholder="any" onChange={(e) => setS({ ...s, length: e.target.value })} /></Field>
          <Field label="Format"><select className={inputCls} value={s.format} onChange={(e) => setS({ ...s, format: e.target.value })}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select></Field>
        </div>
        {(['storyboard', 'music', 'sfx', 'subtitles'] as const).map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{{ storyboard: 'Storyboard first', music: 'Background music', sfx: 'Sound effects', subtitles: 'Subtitles' }[k]}</label>)}
        <Field label="Notes for Claude"><textarea className={`${inputCls} h-16`} value={s.notes} onChange={(e) => setS({ ...s, notes: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <div className="flex gap-2"><Button small variant="primary" onClick={save}>Save</Button><Button small onClick={() => setEdit(false)}>Cancel</Button></div>
      </div>
    </Card>);
  return (
    <Card title="Set-up" actions={manage && <Button small variant="ghost" onClick={start}>Edit</Button>}>
      <dl className="text-sm space-y-1.5">
        {b.topic && <div><dt className="text-ink-3 text-xs">About</dt><dd className="text-ink whitespace-pre-wrap">{b.topic}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink-3">Style</dt><dd>{job.style_name}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-3">Storyboard first</dt><dd>{o.storyboard ? 'Yes' : 'No'}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-3">Music</dt><dd>{o.music === false ? 'None' : job.music ? job.music.title : 'Original'}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-3">Sound effects</dt><dd>{o.sfx === false ? 'No' : 'Yes'}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-3">Subtitles</dt><dd>{o.subtitles ? 'Yes' : 'No'}</dd></div>
        <div className="flex justify-between items-center"><dt className="text-ink-3">Platforms</dt><dd className="flex gap-1">{(job.platforms ?? []).map((p: string) => <PlatformTag key={p} code={p} />)}</dd></div>
        {job.machines?.length > 0 && <div className="flex justify-between"><dt className="text-ink-3">Machines</dt><dd>{job.machines.map((m: any) => m.name).join(', ')}</dd></div>}
        {b.notes && <div><dt className="text-ink-3 text-xs">Notes</dt><dd className="text-ink-2 whitespace-pre-wrap">{b.notes}</dd></div>}
        <div className="text-[11px] text-ink-3 pt-1">{job.content_code ? <>Content item <Link className="underline" to="/content">{job.content_code}</Link> · </> : null}created {fmt.date(job.created_at)}</div>
      </dl>
    </Card>);
}

function MaterialCard({ job, files, manage, onChange }: { job: any; files: any[]; manage: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const notInDrive = files.filter((f) => !f.in_drive).length;
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setErr(null);
    try { await uploadFiles(`/api/studio/jobs/${job.id}/files`, Array.from(list), {}, setProgress); onChange(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const label: Record<string, string> = { take: 'Take', voiceover: 'Voiceover', image: 'Picture' };
  return (
    <Card title="Material for Claude" actions={job.folder_link && <a className="text-xs underline text-ink-2" href={job.folder_link} target="_blank" rel="noreferrer">Drive folder</a>}>
      {!files.length ? <div className="text-sm text-ink-3">Nothing uploaded. {job.kind === 'animation' ? 'None needed: Claude animates the topic.' : 'Attach the files in the Claude chat, or add them here so they are kept in Drive.'}</div> : (
        <ul className="space-y-1.5 text-sm">{files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span className="text-[11px] text-ink-3 w-16 shrink-0">{f.take_id ?? label[f.kind]}</span>
            {f.has_thumb ? <img src={`/api/studio/files/${f.id}/thumbnail`} alt="" className="w-12 h-8 object-cover rounded bg-stone-200 shrink-0" /> : null}
            <span className="truncate flex-1" title={f.name}>{f.drive_link ? <a className="underline" href={f.drive_link} target="_blank" rel="noreferrer">{f.name}</a> : f.name}</span>
            {!f.in_drive && <Badge color="amber">not in Drive</Badge>}
            {manage && <button className="text-xs text-ink-3 hover:text-red-700" onClick={async () => { await api(`/api/studio/jobs/${job.id}/files/${f.id}`, { method: 'DELETE' }); onChange(); }}>✕</button>}
          </li>))}</ul>)}
      {notInDrive > 0 && <div className="text-[11px] text-ink-3 mt-2">Files go to Google Drive in the background so Claude can download them.{manage && <> <button className="underline" onClick={async () => { const r = await api<any>(`/api/studio/jobs/${job.id}/upload-to-drive`, { method: 'POST' }); if (r.error) setErr(r.error); onChange(); }}>Send now</button></>}</div>}
      {manage && <label className="mt-3 inline-block text-xs border border-stone-300 rounded-lg px-2 py-1 cursor-pointer hover:border-stone-500">
        <input type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => add(e.target.files)} />{busy ? `Uploading ${Math.round(progress * 100)}%` : '+ Add takes, voiceover or pictures'}</label>}
      <ErrorBox error={err} />
    </Card>);
}

function SuggestionsCard({ job, suggestions, canAdd, onAdded }: { job: any; suggestions: any[]; canAdd: boolean; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = suggestions.filter((s) => !s.is_none);
  return (
    <Card title={`Suggestions (${list.length})`} subtitle="Colleagues' ideas go into the prompt">
      {!list.length ? <div className="text-sm text-ink-3">No suggestions yet.</div> : (
        <ul className="space-y-2">{list.map((s) => (
          <li key={s.id} className="text-sm"><div className="text-[11px] text-ink-3">{s.from_email.replace(/@drive$/, ' (Drive)')} · {fmt.ago(s.received_at)}</div><div className="text-ink whitespace-pre-wrap">{s.text}</div></li>))}</ul>)}
      {canAdd && <div className="mt-3 space-y-2">
        <textarea className={`${inputCls} h-16`} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. show the motor's impeller spinning when he explains the suction" />
        <ErrorBox error={err} />
        <Button small variant="primary" disabled={!text.trim()} onClick={async () => { try { await api(`/api/studio/jobs/${job.id}/suggestions`, { body: { text } }); setText(''); onAdded(); } catch (e) { setErr((e as Error).message); } }}>Add suggestion</Button>
      </div>}
    </Card>);
}
