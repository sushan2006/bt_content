import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, fmt, useApi, useOrigin, withOrigin } from '../lib';
import { Badge, Button, Card, ErrorBox, inputCls, Loading, PageHeader, PlatformTag, Table } from '../components/ui';
import { useMe } from '../main';

const STATUS: Record<string, { label: string; color: any }> = {
  top: { label: '▲ Top quartile', color: 'green' }, typical: { label: 'Typical', color: 'gray' }, below: { label: '▼ Below typical', color: 'amber' },
  needs_attention: { label: '⚠ Needs attention', color: 'red' }, insufficient_data: { label: 'Not enough data yet', color: 'gray' },
};
const JOB_STAGE: Record<string, string> = {
  new: 'Raw footage', waiting_suggestions: 'In suggestions', analyzing: 'Being edited', planning: 'Being edited', rendering: 'Being edited', changes_requested: 'Being edited',
  in_review: 'Waiting for approval', approved: 'Approved', publishing: 'Publishing', published: 'Published', rejected: 'Not approved', failed: 'Needs attention', cancelled: 'Cancelled',
};

/** Every video: the ones made in the Studio and the ones found on the platforms, each with all its posts. */
export default function ContentLibrary() {
  const origin = useOrigin();
  const me = useMe();
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const query = new URLSearchParams(Object.entries({ q: search, platform }).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useApi<any[]>(withOrigin(`/api/content?${query}`, origin), [origin]);
  const sel = `${inputCls} !w-auto !py-1.5`;
  return (
    <>
      <PageHeader title="Content library" subtitle="Every video, made in the Studio or posted directly, with all its posts on Instagram, Facebook and YouTube"
        actions={can(me, 'data.export') && <Button href={withOrigin('/api/export/content.csv', origin)}>Export CSV</Button>} />
      <div className="flex flex-wrap gap-2 mb-5">
        <input className={`${inputCls} !w-72 !py-1.5`} placeholder="Search title or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={sel} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">All platforms</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="youtube">YouTube</option></select>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.map((c) => (
          <Link key={c.id} to={`/content/${c.id}`} className="bg-white border border-stone-200 rounded-xl overflow-hidden hover:border-stone-400 transition flex">
            <div className="w-24 shrink-0 bg-stone-800 flex items-center justify-center text-stone-400 text-[10px]">
              {c.thumbnail_url ? <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
                : c.studio?.cover ? <img src={`/api/studio/versions/${c.studio.cover}/preview/1`} alt="" className="h-full w-full object-cover object-top" /> : 'No picture'}
            </div>
            <div className="p-4 space-y-1.5 min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><span className="text-xs text-ink-3 font-mono">{c.code}</span>
                {c.publication_count > 0 ? <Badge color={STATUS[c.performance_status]?.color}>{STATUS[c.performance_status]?.label}</Badge> : c.studio ? <Badge color="violet">{c.studio.status === 'published' ? 'Ready to post' : JOB_STAGE[c.studio.status] ?? 'Studio'}</Badge> : null}</div>
              <div className="font-medium text-sm leading-snug line-clamp-2">{c.title}</div>
              <div className="text-xs text-ink-2">{c.studio ? `Made in the Studio (${c.studio.code})` : 'Posted directly'}{c.first_published_at ? ` · ${fmt.date(c.first_published_at)}` : ''}</div>
              <div className="flex flex-wrap gap-3">{c.platforms.length ? c.platforms.map((p: string) => <PlatformTag key={p} code={p} />) : <span className="text-xs text-ink-3">Not posted yet</span>}</div>
              {c.publication_count > 0 && <div className="flex gap-4 text-xs text-ink-2 pt-1 border-t border-stone-100">
                <span><strong className="text-ink tabular-nums">{fmt.n(c.total_views)}</strong> views</span>
                <span><strong className="text-ink tabular-nums">{fmt.n(c.engagement)}</strong> engagements</span>
              </div>}
            </div>
          </Link>
        ))}
      </div>
      {data && !data.length && <Card><div className="text-sm text-ink-2 text-center py-6">No videos yet. Videos made in the Studio appear here straight away; posts from connected accounts appear after the first sync.</div></Card>}
      <UnlinkedPosts origin={origin} canEdit={can(me, 'content.edit')} videos={data ?? []} onChange={reload} />
    </>
  );
}

/** Posts synced from a platform that are not tied to a video yet. Linking them lets the same video be compared across platforms. */
function UnlinkedPosts({ origin, canEdit, videos, onChange }: { origin: string; canEdit: boolean; videos: any[]; onChange: () => void }) {
  const { data, reload } = useApi<any[]>(withOrigin('/api/publications?unlinked=true', origin), [origin]);
  if (!data?.length) return null;
  const link = async (id: string, cid: string) => { await api(`/api/publications/${id}/link`, { body: { content_item_id: cid || null } }); reload(); onChange(); };
  const create = async (id: string) => { await api(`/api/publications/${id}/create-content`, { method: 'POST' }); reload(); onChange(); };
  return (
    <Card className="mt-6" title={`Posts not tied to a video (${data.length})`} subtitle="Posts made outside the Studio. Pick the video each one belongs to, so the same video can be compared on every platform.">
      <Table rows={data} columns={[
        { key: 'p', label: 'Platform', render: (r) => <PlatformTag code={r.platform_code} /> },
        { key: 'title', label: 'Post', render: (r) => <Link to={`/publication/${r.id}`} className="hover:underline">{r.title || r.platform_post_id}</Link> },
        { key: 'published_at', label: 'Posted', render: (r) => fmt.date(r.published_at) },
        { key: 'views', label: 'Views', align: 'right', render: (r) => fmt.n(r.views) },
        ...(canEdit ? [{ key: 'link', label: 'Belongs to', render: (r: any) => (
          <div className="flex gap-2 items-center">
            <select className={`${inputCls} !w-56 !py-1`} value="" onChange={(e) => e.target.value && link(r.id, e.target.value)}>
              <option value="">Choose a video…</option>{videos.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </select>
            <Button small onClick={() => create(r.id)}>It's a new video</Button>
          </div>) }] : []),
      ]} />
    </Card>
  );
}
