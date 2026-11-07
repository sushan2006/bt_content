import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { can, fmt, useApi, useOrigin, withOrigin } from '../../lib';
import { Button, Card, Empty, Loading, PageHeader } from '../../components/ui';
import { useMe } from '../../main';
import { StatusBadge, styleLabel } from './common';

/** The five stages a video goes through, in order. Each status belongs to exactly one stage. */
const STAGES: { key: string; title: string; hint: string; statuses: string[] }[] = [
  { key: 'raw', title: 'Raw footage', hint: 'Takes received, editing not started', statuses: ['new'] },
  { key: 'suggestions', title: 'Suggestions', hint: 'Colleagues can add suggestions', statuses: ['waiting_suggestions'] },
  { key: 'editing', title: 'Editing', hint: 'Choosing takes, planning, rendering', statuses: ['analyzing', 'planning', 'rendering', 'changes_requested'] },
  { key: 'approval', title: 'Waiting for approval', hint: 'Versions ready to watch', statuses: ['in_review'] },
  { key: 'done', title: 'Completed', hint: 'Approved, in content_final or published', statuses: ['approved', 'publishing', 'published'] },
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
  const failed = all.filter((j) => j.status === 'failed');
  const published = all.filter((j) => (j.published_on ?? []).length > 0).length;   // really posted on a platform, not only ready to post by hand
  const recentDone = [...inStage('done')].sort((a, b) => +new Date(b.completed_at ?? b.updated_at) - +new Date(a.completed_at ?? a.updated_at));
  const service = status.data?.service;
  const picked = STAGES.find((s) => s.key === stage);

  return (
    <>
      <PageHeader title="Studio dashboard" subtitle="Where every video is right now"
        actions={can(me, 'studio.manage') && <Button variant="primary" onClick={() => nav('/studio/new')}>+ New video</Button>} />

      {status.data && !service?.studio?.ok && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm mb-4">The video service is not running, so nothing can be edited. Close the window and start <b>RUN_DEMO.bat</b> again.</div>
      )}
      {failed.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm mb-4">
          {failed.length} video{failed.length > 1 ? 's need' : ' needs'} attention: {failed.map((j, i) => <span key={j.id}>{i > 0 && ', '}<Link className="underline" to={`/studio/${j.id}`}>{j.code} {j.title}</Link></span>)}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {STAGES.map((s) => {
          const n = inStage(s.key).length;
          const on = stage === s.key;
          return (
            <button key={s.key} onClick={() => setStage(on ? null : s.key)}
              className={`text-left bg-white border rounded-xl p-4 transition ${on ? 'border-ink ring-2 ring-stone-200' : 'border-stone-200 hover:border-stone-400'}`}>
              <div className="text-xs text-ink-2">{s.title}</div>
              <div className="text-3xl font-semibold text-ink mt-1 tabular-nums">{n}</div>
              <div className="text-[11px] text-ink-3 mt-1">{s.key === 'done' ? `${published} posted on a platform` : s.hint}</div>
            </button>
          );
        })}
      </div>

      {picked ? (
        <Card title={`${picked.title} (${inStage(picked.key).length})`} actions={<Button small variant="ghost" onClick={() => setStage(null)}>Show the summary</Button>}>
          <VideoRows rows={inStage(picked.key)} empty={`No videos in ${picked.title.toLowerCase()}.`} />
        </Card>
      ) : !all.length ? (
        <Card><Empty>No videos yet. Click <b>+ New video</b>, or drop a folder with the takes into <b>content_raw</b> in Google Drive.</Empty></Card>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <Card title="Waiting for approval" subtitle="Open one to watch the versions and approve">
            <VideoRows rows={inStage('approval')} empty="Nothing to approve." />
          </Card>
          <Card title="In suggestions" subtitle="Add your suggestions before the edit starts">
            <VideoRows rows={inStage('suggestions')} empty="No video is collecting suggestions." />
          </Card>
          <Card title="Recently completed" actions={<Link to="/studio/completed" className="text-xs underline text-ink-2">All completed</Link>}>
            <VideoRows rows={recentDone.slice(0, 6)} empty="No completed videos yet." done />
          </Card>
        </div>
      )}
    </>
  );
}

function VideoRows({ rows, empty, done }: { rows: any[]; empty: string; done?: boolean }) {
  if (!rows.length) return <div className="text-sm text-ink-3 py-3">{empty}</div>;
  return (
    <ul className="divide-y divide-stone-100 -my-2">
      {rows.map((j) => (
        <li key={j.id}>
          <Link to={`/studio/${j.id}`} className="flex items-center gap-3 py-2.5 hover:bg-stone-50 -mx-2 px-2 rounded-lg">
            <div className="w-10 h-14 rounded bg-stone-800 overflow-hidden shrink-0">
              {j.cover_version_id && j.has_preview && <img src={`/api/studio/versions/${j.cover_version_id}/preview/1`} className="w-full h-full object-cover object-top" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink truncate">{j.title}</div>
              <div className="text-[11px] text-ink-3 truncate">
                {j.code} · {done && j.approved_variant ? `${styleLabel(j.approved_variant)} · ` : ''}{fmt.ago(done ? j.completed_at ?? j.updated_at : j.updated_at)}
                {done && (j.final_drive_link?.startsWith('http') ? ' · in Drive' : j.completed_at ? ' · not in Drive yet' : '')}
              </div>
            </div>
            <StatusBadge s={j.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

