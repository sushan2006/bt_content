import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, useApi } from '../../lib';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, PlatformTag } from '../../components/ui';
import { useMe } from '../../main';

export default function StudioCompleted() {
  const me = useMe();
  const { data, reload } = useApi<any>('/api/studio/completed');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');

  const run = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(key); setErr(null); setMsg(null);
    try { setMsg(ok(await fn())); } catch (e) { setErr((e as Error).message); }
    setBusy(null); reload();
  };

  return (
    <>
      <PageHeader title="Completed videos" subtitle={data.folder ? <>Approved videos · stored in <b>{data.folder}</b></> : 'Connect Google Drive in Integrations to keep the final videos in content_final'}
        actions={<>
          {manage && data.not_in_drive > 0 && <Button variant="primary" disabled={!!busy} onClick={() => run('all', () => api('/api/studio/completed/sync', { method: 'POST' }),
            (r) => `${r.sent.length ? `Sent to Google Drive: ${r.sent.join(', ')}.` : ''}${r.failed.length ? ` Could not send: ${r.failed.map((f: any) => `${f.code} (${f.error})`).join('; ')}` : ''}` || 'Nothing to send')}>
            {busy === 'all' ? 'Sending…' : `Send ${data.not_in_drive} to Google Drive`}</Button>}
          <Button onClick={reload}>Refresh</Button>
        </>} />
      {msg && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">{msg}</div>}
      <ErrorBox error={err ?? data.error} />
      {!data.items.length ? (
        <Card><Empty>No completed videos yet. When a version is approved, the final video goes to <b>content_final</b> and shows up here.</Empty></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-1">
          {data.items.map((it: any) => (
            <div key={it.key} className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col">
              <video src={it.stream} controls preload="metadata" className="w-full aspect-[9/16] bg-black" />
              <div className="p-3 text-sm flex-1 flex flex-col gap-1.5">
                <div className="font-semibold text-ink truncate" title={it.name}>{it.job?.title ?? it.name}</div>
                {it.job && <div className="text-xs text-ink-2">{it.job.code} · {it.job.style_name}{it.job.approved_by_email ? ` · approved by ${it.job.approved_by_email}` : ''}</div>}
                <div className="flex flex-wrap gap-1 items-center">
                  {it.in_google ? <Badge color="green">In Google Drive</Badge> : <Badge color="amber">Not in Google Drive yet</Badge>}
                  {(it.job?.published_on ?? []).map((p: string) => <span key={p} className="ml-1"><PlatformTag code={p} /></span>)}
                </div>
                {it.job?.final_error && !it.in_google && <div className="text-[11px] text-red-700">{it.job.final_error}</div>}
                <div className="text-[11px] text-ink-3">{it.modified ? new Date(it.modified).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}{it.size ? ` · ${(it.size / 1e6).toFixed(1)} MB` : ''}</div>
                <div className="mt-auto pt-2 flex flex-wrap gap-3 text-xs items-center">
                  {it.job && <Link className="underline" to={`/studio/${it.job.id}`}>Open the video</Link>}
                  {it.drive_link?.startsWith('http') && <a className="underline" href={it.drive_link} target="_blank" rel="noreferrer">Open in Drive</a>}
                  <a className="underline" href={it.stream} download={it.name}>Download</a>
                  {manage && it.can_send && it.job && <Button small variant="primary" disabled={!!busy} onClick={() => run(it.key, () => api(`/api/studio/jobs/${it.job.id}/deliver`, { method: 'POST' }), () => `${it.job.code} sent to Google Drive › content_final`)}>{busy === it.key ? 'Sending…' : 'Send to Drive'}</Button>}
                </div>
              </div>
            </div>))}
        </div>)}
    </>
  );
}
