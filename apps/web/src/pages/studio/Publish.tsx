import { useState } from 'react';
import { api } from '../../lib';
import { Badge, Button, ErrorBox, Field, inputCls, PlatformTag } from '../../components/ui';
import { listInput, PLATFORMS } from './common';

const POST_STATUS: Record<string, { label: string; color: any }> = {
  scheduled: { label: 'Scheduled', color: 'blue' }, uploading: { label: 'Uploading', color: 'blue' }, processing: { label: 'Processing', color: 'blue' },
  published: { label: 'Posted', color: 'green' }, failed: { label: 'Failed', color: 'red' }, manual: { label: 'Post by hand', color: 'amber' }, cancelled: { label: 'Cancelled', color: 'gray' },
};

/** Captions per platform (pre-filled from "<JOB> captions.txt"), then publish now or at a set time. */
export function PublishForm({ job, onDone }: { job: any; onDone: () => void }) {
  const c = job.final_captions ?? {};
  const tagsLine = (c.hashtags ?? []).map((h: string) => `#${h}`).join(' ');
  const withTags = (t?: string) => (t && tagsLine && !t.includes('#') ? `${t}\n\n${tagsLine}` : t ?? tagsLine);
  const [on, setOn] = useState<string[]>(job.platforms?.length ? job.platforms : ['instagram', 'facebook', 'youtube']);
  const [ig, setIg] = useState(withTags(c.instagram) ?? '');
  const [fb, setFb] = useState(c.facebook ?? c.instagram ?? '');
  const [ytTitle, setYtTitle] = useState(c.youtube_title ?? job.title ?? '');
  const [ytDesc, setYtDesc] = useState(c.youtube_description ?? c.facebook ?? '');
  const [ytTags, setYtTags] = useState((c.youtube_tags ?? c.hashtags ?? []).join(', '));
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (p: string, v: boolean) => setOn(v ? [...on, p] : on.filter((x) => x !== p));

  const publish = async () => {
    setErr(null);
    if (!on.length) return setErr('Pick at least one platform.');
    if (on.includes('youtube') && !ytTitle.trim()) return setErr('Give the YouTube video a title.');
    if (when && new Date(when).getTime() < Date.now() - 60_000) return setErr('The scheduled time is in the past.');
    const posts = on.map((p) => p === 'instagram' ? { platform: p, caption: ig } : p === 'facebook' ? { platform: p, caption: fb }
      : { platform: p, caption: ytDesc, title: ytTitle.trim(), tags: listInput(ytTags).map((t) => t.replace(/^#/, '')) });
    if (!confirm(`${when ? 'Schedule' : 'Publish'} on ${on.join(', ')}${when ? ` at ${new Date(when).toLocaleString('en-IN')}` : ' now'}?`)) return;
    setBusy(true);
    try {
      await api(`/api/studio/jobs/${job.id}/publish`, { body: { posts, publish_at: when ? new Date(when).toISOString() : null } });
      await api(`/api/studio/jobs/${job.id}/captions`, { method: 'PATCH', body: { instagram: ig, facebook: fb, youtube_title: ytTitle.slice(0, 100), youtube_description: ytDesc, youtube_tags: listInput(ytTags) } }).catch(() => {});
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {job.has_cover && <div className="flex items-center gap-2 text-xs text-ink-2"><img src={`/api/studio/jobs/${job.id}/thumbnail?v=${job.cover_v}`} alt="" className="w-8 h-10 object-cover rounded border border-stone-200" />This thumbnail is used as the cover on every platform (change it above).</div>}
      {!job.final_captions && <div className="text-xs text-ink-3">No captions file found next to the video. Write them here, or put <code>{job.code} captions.txt</code> in content_final.</div>}
      <div className="flex flex-wrap gap-3">{PLATFORMS.map((p) => (
        <label key={p.k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on.includes(p.k)} onChange={(e) => toggle(p.k, e.target.checked)} />{p.l}</label>))}</div>
      {on.includes('instagram') && <Field label={`Instagram caption (${ig.length}/2200)`}><textarea className={`${inputCls} h-28`} value={ig} maxLength={2200} onChange={(e) => setIg(e.target.value)} /></Field>}
      {on.includes('facebook') && <Field label="Facebook description"><textarea className={`${inputCls} h-24`} value={fb} onChange={(e) => setFb(e.target.value)} /></Field>}
      {on.includes('youtube') && (
        <div className="space-y-3">
          <Field label={`YouTube title (${ytTitle.length}/100)`}><input className={inputCls} value={ytTitle} maxLength={100} onChange={(e) => setYtTitle(e.target.value)} /></Field>
          <Field label="YouTube description"><textarea className={`${inputCls} h-24`} value={ytDesc} onChange={(e) => setYtDesc(e.target.value)} /></Field>
          <Field label="YouTube tags" hint="Comma separated"><input className={inputCls} value={ytTags} onChange={(e) => setYtTags(e.target.value)} /></Field>
        </div>)}
      <Field label="When" hint="Leave empty to publish now"><input type="datetime-local" className={`${inputCls} max-w-xs`} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <ErrorBox error={err} />
      <Button variant="primary" disabled={busy} onClick={publish}>{busy ? 'Starting…' : when ? 'Schedule' : 'Publish now'}</Button>
    </div>
  );
}

/** Where each post stands, with retry and "I posted it by hand". */
export function PostList({ posts, manage, onChange }: { posts: any[]; manage: boolean; onChange: () => void }) {
  const [link, setLink] = useState<Record<string, string>>({});
  if (!posts.length) return null;
  return (
    <ul className="divide-y divide-stone-100">
      {posts.map((p) => (
        <li key={p.id} className="py-2.5 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformTag code={p.platform_code} />
            <Badge color={POST_STATUS[p.status]?.color ?? 'gray'}>{POST_STATUS[p.status]?.label ?? p.status}</Badge>
            {p.status === 'scheduled' && <span className="text-xs text-ink-3">{new Date(p.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            {p.permalink && <a className="text-xs underline" href={p.permalink} target="_blank" rel="noreferrer">Open the post</a>}
            {manage && ['failed', 'manual'].includes(p.status) && <Button small onClick={async () => { await api(`/api/studio/publish-jobs/${p.id}/retry`, { method: 'POST' }); onChange(); }}>Try again</Button>}
          </div>
          {p.error && <div className="text-xs text-red-700 mt-1">{p.error}</div>}
          {manage && ['failed', 'manual'].includes(p.status) && (
            <div className="flex gap-2 mt-1.5">
              <input className={`${inputCls} text-xs py-1 max-w-sm`} placeholder="Link of the post, if you posted it by hand" value={link[p.id] ?? ''} onChange={(e) => setLink({ ...link, [p.id]: e.target.value })} />
              <Button small onClick={async () => { try { await api(`/api/studio/publish-jobs/${p.id}/posted`, { body: { permalink: link[p.id] || null } }); onChange(); } catch (e) { alert((e as Error).message); } }}>I posted it</Button>
            </div>)}
        </li>))}
    </ul>
  );
}
