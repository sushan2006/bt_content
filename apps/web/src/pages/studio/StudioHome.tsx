import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { can, fmt, useApi, useOrigin, withOrigin } from '../../lib';
import { Button, Card, Empty, Loading, PageHeader, PlatformTag } from '../../components/ui';
import { useMe } from '../../main';
import { StatusBadge } from './common';

/** The four stages a video goes through, in order. Each status belongs to exactly one stage. */
const STAGES: { key: string; title: string; hint: string; statuses: string[] }[] = [
  { key: 'ready', title: 'Prompt ready', hint: 'Set up; prompt not copied yet', statuses: ['prompt_ready'] },
  { key: 'claude', title: 'Editing with Claude', hint: 'Being edited in Claude Code', statuses: ['with_claude'] },
  { key: 'done', title: 'Ready to publish', hint: 'Finished video in content_final', statuses: ['completed', 'publishing'] },
  { key: 'live', title: 'Published', hint: 'Posted, or ready to post by hand', statuses: ['published'] },
];

export default function StudioHome() {
  const me = useMe();
  const origin = useOrigin();
  const nav = useNavigate();
  const status = useApi<any>('/api/studio/status');
  const jobs = useApi<any[]>(withOrigin('/api/studio/jobs', origin), [origin]);
  const [stage, setStage] = useState<string | null>(null);
  if (!jobs.data) return <Loading />;
  const all = jobs.data;
  const inStage = (k: string) => all.filter((j) => STAGES.find((s) => s.key === k)!.statuses.includes(j.status));
  const picked = STAGES.find((s) => s.key === stage);
  const ws = status.data?.workspace;

  return (
    <>
      <PageHeader title="Studio dashboard" subtitle="Where every video is right now"
        actions={can(me, 'studio.manage') && <Button variant="primary" onClick={() => nav('/studio/new')}>+ New video</Button>} />
      {status.data && (!ws || ws.local) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm mb-4">
          Google Drive is not connected, so the footage stays on this computer and finished videos are read from the local folder <code>{ws?.root ?? 'drive_local'}</code>. Connect Drive in <Link className="underline" to="/integrations">Integrations</Link>.</div>)}
      {ws?.status === 'token_expired' && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm mb-4">Google Drive needs to be reconnected ({ws.last_error}). <Link className="underline" to="/integrations">Integrations</Link></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {STAGES.map((s) => {
          const n = inStage(s.key).length;
          const on = stage === s.key;
          return (
            <button key={s.key} onClick={() => setStage(on ? null : s.key)}
              className={`text-left bg-white border rounded-xl p-4 transition ${on ? 'border-ink ring-2 ring-stone-200' : 'border-stone-200 hover:border-stone-400'}`}>
              <div className="text-xs text-ink-2">{s.title}</div>
              <div className="text-3xl font-semibold text-ink mt-1 tabular-nums">{n}</div>
              <div className="text-[11px] text-ink-3 mt-1">{s.hint}</div>
            </button>);
        })}
      </div>

      {picked ? (
        <Card title={`${picked.title} (${inStage(picked.key).length})`} actions={<Button small variant="ghost" onClick={() => setStage(null)}>Show the summary</Button>}>
          <VideoRows rows={inStage(picked.key)} empty={`No videos in ${picked.title.toLowerCase()}.`} />
        </Card>
      ) : !all.length ? (
        <Card><Empty>No videos yet. Click <b>+ New video</b>, pick a style and copy the prompt into Claude Code.</Empty></Card>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <Card title="Prompt ready" subtitle="Copy the prompt into Claude Code"><VideoRows rows={inStage('ready')} empty="Nothing waiting." /></Card>
          <Card title="Editing with Claude" subtitle="Put the finished video in content_final"><VideoRows rows={inStage('claude')} empty="Nothing being edited." /></Card>
          <Card title="Ready to publish" actions={<Link to="/studio/completed" className="text-xs underline text-ink-2">All finished videos</Link>}>
            <VideoRows rows={inStage('done')} empty="No finished videos waiting." />
          </Card>
        </div>
      )}
    </>
  );
}

function VideoRows({ rows, empty }: { rows: any[]; empty: string }) {
  if (!rows.length) return <div className="text-sm text-ink-3 py-3">{empty}</div>;
  return (
    <ul className="divide-y divide-stone-100 -my-2">
      {rows.map((j) => (
        <li key={j.id}>
          <Link to={`/studio/${j.id}`} className="flex items-center gap-3 py-2.5 hover:bg-stone-50 -mx-2 px-2 rounded-lg">
            {j.has_cover ? <img src={`/api/studio/jobs/${j.id}/thumbnail?v=${j.cover_v}`} alt="" className="w-9 h-12 object-cover rounded bg-stone-200 shrink-0" />
              : <div className="w-9 h-12 rounded bg-stone-100 border border-stone-200 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink truncate">{j.title}</div>
              <div className="text-[11px] text-ink-3 truncate flex items-center gap-1">
                <span className="font-mono">{j.code}</span> · {fmt.ago(j.completed_at ?? j.prompt_copied_at ?? j.created_at)}
                {j.suggestions > 0 && <> · {j.suggestions} suggestion{j.suggestions > 1 ? 's' : ''}</>}
                {(j.published_on ?? []).map((p: string) => <span key={p} className="ml-1"><PlatformTag code={p} /></span>)}
              </div>
            </div>
            <StatusBadge s={j.status} />
          </Link>
        </li>))}
    </ul>
  );
}
