import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, fmt, useApi, useOrigin, withOrigin } from '../../lib';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, PlatformTag } from '../../components/ui';
import { useMe } from '../../main';
import { fmtMB, StatusBadge, THUMB_SOURCE } from './common';

/** Every finished video: the ones in content_final waiting to be published, and the published ones. */
export default function StudioCompleted() {
  const me = useMe();
  const origin = useOrigin();
  const { data, reload } = useApi<any>(withOrigin('/api/studio/completed', origin), [origin]);
  const [filter, setFilter] = useState<'ready' | 'published' | 'all'>('ready');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');
  const items = data.items.filter((i: any) => filter === 'all' || (filter === 'ready' ? i.status !== 'published' : i.status === 'published'));

  const scan = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api<any>('/api/studio/completed/scan', { method: 'POST' });
      if (r.error) setErr(r.error);
      else setMsg([...r.linked, ...r.imported].length ? `New in content_final: ${[...r.linked, ...r.imported].join(', ')}` : 'Checked: nothing new in content_final.');
      reload();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Completed videos" subtitle={data.folder ? <>Finished videos from <b>{data.folder}</b>. Videos whose name starts with a job code (JOB-012 …) join their video; any other video is added as a new one.</> : 'Connect Google Drive in Integrations'}
        actions={<>{manage && <Button variant="primary" disabled={busy} onClick={scan}>{busy ? 'Checking…' : 'Check content_final now'}</Button>}<Button onClick={reload}>Refresh</Button></>} />
      {msg && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">{msg}</div>}
      <ErrorBox error={err} />
      <div className="flex gap-1 mb-4 text-sm">
        {([['ready', 'Ready to publish'], ['published', 'Published'], ['all', 'All']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg border ${filter === k ? 'border-ink bg-ink text-white' : 'border-stone-200 text-ink-2 hover:border-stone-400'}`}>{l} ({data.items.filter((i: any) => k === 'all' || (k === 'ready' ? i.status !== 'published' : i.status === 'published')).length})</button>))}
      </div>
      {!items.length ? (
        <Card><Empty>{filter === 'published' ? 'Nothing published yet.' : <>No finished videos waiting. When Claude's edit is approved, put the video in <b>content_final</b> (named with its job code) and it shows up here.</>}</Empty></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((it: any) => (
            <div key={it.id} className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col">
              <video src={`/api/studio/jobs/${it.id}/final`} poster={it.has_cover ? `/api/studio/jobs/${it.id}/thumbnail?v=${it.cover_v}` : undefined} controls preload={it.has_cover ? 'none' : 'metadata'} className={`w-full bg-black ${it.options?.format === '16:9' ? 'aspect-video' : 'aspect-[9/16]'}`} />
              <div className="p-3 text-sm flex-1 flex flex-col gap-1.5">
                <div className="font-semibold text-ink truncate" title={it.final_name}>{it.title}</div>
                <div className="text-xs text-ink-2"><span className="font-mono">{it.code}</span>{it.source !== 'content_final' && it.style_name ? ` · ${it.style_name}` : ' · added from content_final'}</div>
                <div className="flex flex-wrap gap-1 items-center">
                  <StatusBadge s={it.status} />
                  {it.final_captions ? <Badge color="gray">captions ✓</Badge> : null}
                  {it.thumbnail_source ? <span title={THUMB_SOURCE[it.thumbnail_source]}><Badge color="gray">thumbnail ✓</Badge></span> : null}
                  {(it.posts ?? []).filter((p: any) => p.status === 'published').map((p: any) => <span key={p.platform}><PlatformTag code={p.platform} /></span>)}
                </div>
                {(it.posts ?? []).some((p: any) => ['failed', 'manual'].includes(p.status)) && <div className="text-[11px] text-amber-800">Some posts need attention (open the video).</div>}
                <div className="text-[11px] text-ink-3">{fmt.dt(it.completed_at)}{it.final_size ? ` · ${fmtMB(it.final_size)}` : ''}</div>
                <div className="mt-auto pt-2 flex flex-wrap gap-3 text-xs items-center">
                  <Link className={it.status === 'completed' && manage ? 'bg-ink text-white rounded-md px-2.5 py-1 font-medium' : 'underline'} to={`/studio/${it.id}`}>{it.status === 'completed' && manage ? 'Publish →' : 'Open'}</Link>
                  {it.final_drive_link && <a className="underline" href={it.final_drive_link} target="_blank" rel="noreferrer">Drive</a>}
                  <a className="underline" href={`/api/studio/jobs/${it.id}/final?download=1`}>Download</a>
                </div>
              </div>
            </div>))}
        </div>)}
    </>
  );
}
