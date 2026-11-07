import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, can, fmt, useApi } from '../../lib';
import { Badge, Button, Card, Disclosure, Empty, ErrorBox, inputCls, Loading, PageHeader, PlatformTag, Table } from '../../components/ui';
import { useMe } from '../../main';
import { Pill, StatusBadge, Stepper, styleLabel } from './common';
import { DirectorPanel } from './DirectorPanel';

const BUSY = ['new', 'waiting_suggestions', 'analyzing', 'planning', 'rendering', 'approved', 'publishing'];

export default function StudioJob() {
  const { id } = useParams();
  const me = useMe();
  const { data, reload, error } = useApi<any>(`/api/studio/jobs/${id}`, [id]);
  const emailMode = useApi<any>('/api/studio/settings').data?.review_mode === 'email';
  const [tab, setTab] = useState('review');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [changes, setChanges] = useState('');
  const [reply, setReply] = useState('');
  const [sugg, setSugg] = useState('');
  const [rev, setRev] = useState<number | null>(null);
  const [board, setBoard] = useState<Record<string, { times: number[]; count: number } | 'loading'>>({});
  useEffect(() => {
    if (!data || !BUSY.includes(data.job.status)) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { job } = data;
  const act = async (fn: () => Promise<any>, ok: string) => { setErr(null); setMsg(null); try { const r = await fn(); setMsg(typeof ok === 'string' ? ok : ''); reload(); return r; } catch (e) { setErr((e as Error).message); } };
  const revisions = [...new Set<number>(data.versions.map((v: any) => v.revision))].sort((a, b) => b - a);
  const shownRev = rev ?? revisions[0] ?? job.revision;
  const versions = data.versions.filter((v: any) => v.revision === shownRev && v.aspect === '9:16');
  const landscape = data.versions.filter((v: any) => v.aspect === '16:9');
  const canApprove = can(me, 'studio.approve') && job.status === 'in_review' && shownRev === job.revision;
  const manage = can(me, 'studio.manage');

  return (
    <>
      <PageHeader title={job.title} subtitle={<>{job.code} · content {job.content_code} · revision {job.revision} · {job.source === 'drive' ? 'from Google Drive' : 'uploaded'} · {job.platforms.map((p: string) => fmt.label(p)).join(', ')}{job.style_names?.length ? <> · styles: {job.style_names.join(', ')}</> : null}{job.machines?.length ? <> · {job.machines.length > 1 ? 'machines' : 'machine'}: {job.machines.map((m: any) => m.name + (m.status === 'building' ? ' (3D model building…)' : m.status === 'failed' ? ' (3D model failed)' : '')).join(', ')}</> : null}</>}
        actions={<>
          {manage && job.status === 'failed' && <Button onClick={() => act(() => api(`/api/studio/jobs/${id}/retry`, { method: 'POST' }), 'Retrying')}>Retry</Button>}
          {manage && ['in_review', 'rejected', 'failed'].includes(job.status) && <Button onClick={() => act(() => api(`/api/studio/jobs/${id}/replan`, { method: 'POST' }), 'Re-editing with the current settings')}>Re-edit with current settings</Button>}
          {manage && job.status === 'waiting_suggestions' && <Button onClick={() => act(() => api(`/api/studio/jobs/${id}/skip-suggestions`, { method: 'POST' }), 'Starting the edit now')}>Start editing now</Button>}
          {manage && !['published', 'publishing', 'cancelled'].includes(job.status) && <Button variant="danger" onClick={() => confirm('Cancel this video?') && act(() => api(`/api/studio/jobs/${id}`, { method: 'DELETE' }), 'Cancelled')}>Cancel</Button>}
        </>} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <div className="min-w-0">
      <Card className="mb-5">
        <Stepper status={job.status} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusBadge s={job.status} />
          <span className="text-sm text-ink-2">{job.status_detail}</span>
          {BUSY.includes(job.status) && <span className="text-xs text-ink-3 animate-pulse">working…</span>}
        </div>
        {job.error && <div className="mt-3"><ErrorBox error={job.error} /></div>}
        {job.completed_at && (job.final_drive_link?.startsWith('http')
          ? <div className="mt-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2">Final video ({job.approved_name}) is in Google Drive › <b>content_final</b>. <a className="underline" href={job.final_drive_link} target="_blank" rel="noreferrer">Open in Drive</a> <a className="underline ml-2" href="/studio/completed">All completed videos</a></div>
          : <div className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2 flex flex-wrap items-center gap-2">
              <span>Final video ({job.approved_name}) is approved but <b>not in Google Drive yet</b>.{job.final_error ? <> {job.final_error}</> : null}</span>
              {manage && <Button small variant="primary" onClick={() => act(() => api(`/api/studio/jobs/${id}/deliver`, { method: 'POST' }), 'Sent to Google Drive › content_final')}>Send to Drive</Button>}
            </div>)}
      </Card>
      {msg && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">{msg}</div>}
      <ErrorBox error={err} />

      <div className="flex gap-1 border-b border-stone-200 mb-5 text-sm">
        {[['review', 'Review & approve'], ['takes', 'Takes & choices'], ['suggestions', `Suggestions (${data.suggestions.length})`], ...(emailMode || data.emails.length ? [['emails', 'Emails']] : []), ['publishing', 'Publishing'], ['history', 'History']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-2 hover:text-ink'}`}>{l}</button>))}
      </div>

      {tab === 'review' && (
        <>
          {revisions.length > 1 && <div className="flex items-center gap-2 mb-3 text-sm"><span className="text-ink-2">Revision</span>{revisions.map((r) => <button key={r} onClick={() => setRev(r)} className={`px-2.5 py-1 rounded-md border text-xs ${r === shownRev ? 'bg-ink text-white border-ink' : 'border-stone-300'}`}>{r}{r === job.revision ? ' (current)' : ''}</button>)}</div>}
          {!versions.length ? <Card><Empty>The versions appear here as soon as they are rendered.</Empty></Card> : (
            <div className={`grid gap-4 ${versions.length >= 4 ? "md:grid-cols-2 2xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-3"}`}>
              {versions.map((v: any) => {
                const rec = v.variant === job.recommended_variant, approved = job.approved_variant === v.variant && job.approved_at;
                return (
                  <div key={v.id} className={`bg-white rounded-xl border ${approved ? 'border-emerald-500 ring-2 ring-emerald-100' : rec ? 'border-amber-400' : 'border-stone-200'} overflow-hidden flex flex-col`}>
                    <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                      <div><div className="text-sm font-semibold text-ink">Version {v.label} · {v.name}</div><div className="text-[11px] text-ink-3">{v.summary?.length?.toFixed?.(1)} s · {v.summary?.cuts} cuts{v.summary?.music ? ` · music: ${v.summary.music}` : ' · no music'}</div></div>
                      {approved ? <Badge color="green">Approved</Badge> : rec ? <Badge color="amber">Recommended</Badge> : null}
                    </div>
                    <div className="bg-black">
                      {v.status === 'ready' ? <video src={`/api/studio/versions/${v.id}/video`} poster={v.preview_count ? `/api/studio/versions/${v.id}/preview/0` : undefined} controls preload="none" className="w-full aspect-[9/16] bg-black" />
                        : <div className="aspect-[9/16] flex items-center justify-center text-stone-400 text-sm">{v.status === 'failed' ? <span className="text-red-400 px-4 text-center">Render failed: {v.error}</span> : v.status === 'rendering' ? 'Rendering…' : 'Waiting to render'}</div>}
                    </div>
                    <div className="p-4 flex-1 flex flex-col gap-3">
                      {v.qc && <div className="flex flex-wrap gap-1">{(v.qc.checks ?? []).map((c: any) => <Pill key={c.check} ok={c.ok}>{c.check}</Pill>)}</div>}
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">What the editor did</div>
                        <ul className="text-xs text-ink-2 space-y-1 max-h-48 overflow-auto pr-1">{(v.summary?.steps ?? []).map((s: any, i: number) => <li key={i}><span className="tabular-nums text-ink-3">{s.at}</span> {s.what}</li>)}</ul>
                      </div>
                      {(v.rules ?? []).length > 0 && <div><div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">Data rules</div>
                        <ul className="text-xs space-y-0.5">{v.rules.map((r: any) => <li key={r.code} className={r.applied ? 'text-emerald-800' : 'text-amber-800'}>{r.applied ? '✓' : '–'} {r.how}</li>)}</ul></div>}
                      {(v.claude_notes ?? []).length > 0 && <div className="text-xs bg-violet-50 border border-violet-100 rounded-lg p-2 text-violet-900"><div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5">Claude's idea for this edit</div>{v.claude_notes.join(' ')}</div>}
                      {(v.notes ?? []).length > 0 && <div className="text-[11px] text-ink-3">{v.planner === 'claude' ? 'Planned by Claude · ' : v.planner === 'rules' ? 'Automatic edit · ' : ''}{v.notes.join(' · ')}</div>}
                      <Disclosure label="Captions for each platform">
                        <div className="text-xs space-y-2">
                          <div><b>Instagram</b><pre className="whitespace-pre-wrap font-sans text-ink-2">{v.metadata?.instagram?.caption}</pre></div>
                          <div><b>YouTube title</b> <span className="text-ink-2">{v.metadata?.youtube?.title}</span></div>
                        </div>
                      </Disclosure>
                      <Disclosure label="Storyboard (still frames)">
                        {board[v.id] && board[v.id] !== 'loading' ? <div className="grid grid-cols-4 gap-1">{Array.from({ length: (board[v.id] as any).count }, (_, i) => <img key={i} src={`/api/studio/versions/${v.id}/storyboard/${i}?t=${Date.now()}`} className="w-full rounded" title={`${(board[v.id] as any).times[i]} s`} />)}</div>
                          : <Button small disabled={board[v.id] === 'loading'} onClick={async () => { setBoard({ ...board, [v.id]: 'loading' }); const r = await api(`/api/studio/versions/${v.id}/storyboard`, { body: { frames: 8 } }); setBoard((b) => ({ ...b, [v.id]: r })); }}>{board[v.id] === 'loading' ? 'Drawing…' : 'Show 8 frames'}</Button>}
                      </Disclosure>
                      <div className="mt-auto flex flex-wrap gap-2">
                        {v.status === 'ready' && <Button small href={`/api/studio/versions/${v.id}/video?download=1`}>Download</Button>}
                        {v.drive_link && <Button small href={v.drive_link}>Open in Drive</Button>}
                        {canApprove && v.status === 'ready' && <Button small variant="primary" onClick={() => act(() => api(`/api/studio/jobs/${id}/approve`, { body: { variant: v.variant } }), `Version ${v.label} approved`)}>Approve {v.label}</Button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {canApprove && (
            <div className="grid lg:grid-cols-2 gap-5 mt-5">
              <Card title="Ask for changes" subtitle="Plain words. Each request becomes a new revision of every version.">
                <textarea className={`${inputCls} h-24`} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder='e.g. "Make the logo bigger, cut the first 2 seconds and highlight wireless sensors"' />
                <div className="flex gap-2 mt-2">
                  <Button variant="primary" disabled={changes.trim().length < 3} onClick={async () => { const r = await act(() => api(`/api/studio/jobs/${id}/changes`, { body: { text: changes } }), 'Making the changes'); if (r) { setMsg(`Understood ${r.ops.length} change(s)${r.unhandled.length ? `. Not understood: "${r.unhandled.join(' ')}"` : ''}`); setChanges(''); } }}>Request changes</Button>
                  <Button variant="danger" onClick={() => { const note = prompt('Why is it not approved? (optional)') ?? undefined; act(() => api(`/api/studio/jobs/${id}/reject`, { body: { note } }), 'Marked as not approved'); }}>Not approved</Button>
                </div>
              </Card>
              {emailMode ? (
              <Card title="Test an approver's email reply" subtitle="Type what an approver would write back. It is read exactly like a real email reply.">
                <textarea className={`${inputCls} h-24`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder='"Approved" · "Approve B" · "Go with the cinematic one" · "Not approved" · "Remove the music"' />
                <Button disabled={!reply.trim()} onClick={async () => { const r = await act(() => api(`/api/studio/jobs/${id}/simulate-reply`, { body: { text: reply } }), ''); if (r) { setMsg(`Read as: ${r.understood.decision}${r.understood.version ? ` (version ${r.understood.version})` : ''}`); setReply(''); } }}>Send as reply</Button>
              </Card>) : (
              <Card title="How to approve" subtitle="Everything happens here in the dashboard">
                <ol className="text-sm text-ink-2 list-decimal pl-5 space-y-1">
                  <li>Play each version above (they stream from Google Drive).</li>
                  <li>Press <b>Approve</b> under the one you want. One approval is enough: it goes to <b>content_final</b> and the Completed page.</li>
                  <li>Or write what to change on the left. Every version is re-edited as a new revision and comes back here.</li>
                </ol>
              </Card>)}
            </div>
          )}
          {landscape.length > 0 && <Card title="Landscape YouTube version" className="mt-5">{landscape.map((v: any) => v.status === 'ready' ? <video key={v.id} src={`/api/studio/versions/${v.id}/video`} controls className="w-full max-w-3xl rounded" /> : <div key={v.id} className="text-sm text-ink-2">{v.status}</div>)}</Card>}
        </>
      )}

      {tab === 'takes' && (
        <div className="space-y-5">
          <Card title="Takes" subtitle="Measured automatically">
            <Table rows={data.takes} empty="Not analysed yet" columns={[
              { key: 'take_id', label: 'Take' }, { key: 'duration', label: 'Length', render: (r) => fmt.sec(r.duration) },
              { key: 'sentences', label: 'Sentences', align: 'right' },
              { key: 'noise_db', label: 'Background noise', render: (r) => (r.noise_db < -60 ? 'very quiet' : r.noise_db < -45 ? 'quiet' : r.noise_db < -35 ? 'some noise' : 'noisy') },
              { key: 'faces_found', label: 'Face found', render: (r) => (r.faces_found ? `in ${r.faces_found} sentences` : 'no') },
              { key: 'on_camera', label: 'On-camera (Claude)', render: (r) => (r.on_camera == null ? '—' : `${r.on_camera}/10`) },
            ]} />
          </Card>
          <Card title="Which take was used for each line" subtitle="Scores combine sound, delivery and picture. Staying on the same take avoids extra cuts.">
            <Table rows={data.lines} empty="Not analysed yet" columns={[
              { key: 'index', label: '#', render: (r) => r.index + 1 },
              { key: 'text', label: 'Line', className: 'max-w-md' },
              { key: 'take_id', label: 'Used', render: (r) => <Badge color="green">{r.take_id}</Badge> },
              { key: 'reason', label: 'Why', render: (r) => <span className="text-xs text-ink-2">{r.reason}</span> },
              { key: 'c', label: 'All takes', render: (r) => <span className="text-xs tabular-nums">{r.candidates.map((c: any) => `${c.take_id} ${Math.round(c.score)}`).join(' · ')}</span> },
            ]} />
          </Card>
          <Card title="Files">
            <Table rows={data.files} columns={[{ key: 'kind', label: 'Type' }, { key: 'take_id', label: 'Take' }, { key: 'name', label: 'Name' }, { key: 'tags', label: 'Tags', render: (r) => r.tags?.join(', ') }, { key: 'size_bytes', label: 'Size', render: (r) => `${((r.size_bytes ?? 0) / 1e6).toFixed(1)} MB` }]} />
          </Card>
        </div>
      )}

      {tab === 'suggestions' && (
        <Card title="Suggestions" subtitle="Suggestions come first: they override the data rules and the house style.">
          {data.suggestions.length ? <ul className="space-y-3 mb-4">{data.suggestions.map((s: any) => (
            <li key={s.id} className="border border-stone-200 rounded-lg p-3 text-sm">
              <div className="text-xs text-ink-3">{s.from_email} · {fmt.dt(s.received_at)} · by {s.source}</div>
              <div className="mt-1 whitespace-pre-wrap">{s.is_none ? <i className="text-ink-2">No suggestions</i> : s.text}</div>
              {!s.is_none && <div className="text-xs mt-2">{s.ops.length ? <span className="text-emerald-800">Understood: {s.ops.map((o: any) => o.op.replace(/_/g, ' ')).join(', ')}</span> : null}{s.unhandled?.length ? <span className="text-amber-800"> · Passed to the planner as notes: "{s.unhandled.join(' ')}"</span> : null}</div>}
            </li>))}</ul> : <Empty>No suggestions yet.</Empty>}
          {can(me, 'studio.suggest', 'studio.manage') && !['publishing', 'published'].includes(job.status) && <>
            <textarea className={`${inputCls} h-20`} value={sugg} onChange={(e) => setSugg(e.target.value)} placeholder="Add a suggestion for this video" />
            <Button small disabled={!sugg.trim()} onClick={async () => { await act(() => api(`/api/studio/jobs/${id}/suggestions`, { body: { text: sugg } }), 'Suggestion saved'); setSugg(''); }}>Add suggestion</Button>
            {job.status === 'in_review' && <div className="text-[11px] text-ink-3 mt-1">The edit is already made: use "Re-edit with current settings" to apply new suggestions.</div>}
          </>}
        </Card>
      )}

      {tab === 'emails' && (
        <Card title="Emails" subtitle="Sent from the connected Gmail account. Replies are read every minute.">
          {!data.emails.length ? <Empty>No emails yet. Add people in Studio settings and connect Drive & Gmail in Integrations.</Empty> : data.emails.map((t: any) => (
            <div key={t.id} className="border border-stone-200 rounded-lg p-3 mb-3">
              <div className="flex items-center gap-2 text-sm"><Badge color={t.kind === 'approval' ? 'amber' : 'violet'}>{t.kind}</Badge><b>{t.subject}</b><Badge color={t.status === 'failed' ? 'red' : t.status === 'open' ? 'blue' : 'gray'}>{t.status}</Badge></div>
              <div className="text-xs text-ink-3 mt-1">to {t.to_emails.join(', ')} · {fmt.dt(t.sent_at)}{t.error && <span className="text-red-700"> · {t.error}</span>}</div>
              {t.replies.map((r: any, i: number) => (
                <div key={i} className="mt-2 bg-stone-50 rounded p-2 text-xs"><div className="text-ink-3">{r.from} · {fmt.dt(r.at)}{r.classification?.decision && <> · read as <b>{r.classification.decision}</b>{r.classification.version ? ` ${r.classification.version}` : ''}</>}{r.classification?.ignored && <> · ignored: {r.classification.ignored}</>}</div><div className="whitespace-pre-wrap mt-1">{r.body.slice(0, 600)}</div></div>))}
            </div>))}
        </Card>
      )}

      {tab === 'publishing' && (
        <Card title="Publishing" subtitle="Each post is linked to this video in Analytics, so its results are measured like every other post.">
          <Table rows={data.publishing} empty="Nothing to publish yet — approve a version first" columns={[
            { key: 'p', label: 'Platform', render: (r) => <PlatformTag code={r.platform_code} /> }, { key: 'format', label: 'Format' },
            { key: 'status', label: 'Status', render: (r) => <Badge color={r.status === 'published' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'manual' ? 'amber' : 'blue'}>{r.status === 'manual' ? 'post by hand' : r.status}</Badge> },
            { key: 'scheduled_at', label: 'When', render: (r) => fmt.dt(r.scheduled_at) },
            { key: 'permalink', label: 'Link', render: (r) => (r.permalink ? <a className="underline text-xs" href={r.permalink} target="_blank">open</a> : '—') },
            { key: 'error', label: 'Note', render: (r) => <span className="text-xs text-ink-2">{r.error}</span> },
            { key: 'a', label: '', render: (r) => <div className="flex gap-1"><Button small href={`/api/studio/versions/${r.version_id}/video?download=1`}>Download</Button>{manage && ['failed', 'manual'].includes(r.status) && <Button small onClick={() => act(() => api(`/api/studio/publish-jobs/${r.id}/retry`, { method: 'POST' }), 'Publishing again')}>Try again</Button>}</div> },
          ]} />
          {data.publishing.some((p: any) => p.status === 'manual') && <div className="text-xs text-ink-2 mt-3">"Post by hand": download the file and post it in the app; copy the caption from the Review tab. Connect the account (with publishing permission) to publish automatically next time.</div>}
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Decisions">
          <Table rows={data.decisions} empty="No decisions yet" columns={[
            { key: 'created_at', label: 'When', render: (r) => fmt.dt(r.created_at) }, { key: 'revision', label: 'Revision' },
            { key: 'decision', label: 'Decision', render: (r) => <Badge color={r.decision === 'approve' ? 'green' : r.decision === 'reject' ? 'red' : 'blue'}>{r.decision}</Badge> },
            { key: 'variant', label: 'Version', render: (r) => (r.variant ? styleLabel(r.variant) : '—') },
            { key: 'by', label: 'By', render: (r) => `${r.by_email ?? r.by_user_name ?? '—'} (${r.via})` },
            { key: 'note', label: 'Words', render: (r) => <span className="text-xs">{r.note}</span> },
          ]} />
        </Card>
      )}
      </div>
      <DirectorPanel job={job} versions={data.versions} assets={data.assets ?? []} />
      </div>
    </>
  );
}
