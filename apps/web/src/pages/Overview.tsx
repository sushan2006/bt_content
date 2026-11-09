import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, fmt, PLATFORM_COLORS, PLATFORM_NAMES, useApi, useOrigin, withOrigin } from '../lib';
import { axisStyle, Button, Card, CertaintyBadge, Chart, ErrorBox, GradeBadge, Loading, PageHeader, PlatformTag, Stat, Table } from '../components/ui';
import { defaultFilters, filterQuery, Filters } from '../components/Filters';
import { useMe } from '../main';

const PLATFORMS = ['instagram', 'facebook', 'youtube'];
const METRICS: { key: string; label: string; format: (v: number | null) => string; axis: (v: number) => string }[] = [
  { key: 'views', label: 'Views', format: fmt.n, axis: (v) => fmt.n(v) },
  { key: 'avg_view_ratio', label: 'How much was watched', format: (v) => fmt.pct(v, 0), axis: (v) => `${Math.round(v * 100)}%` },
  { key: 'engagement_rate', label: 'Engagement rate', format: (v) => fmt.pct(v, 1), axis: (v) => `${(v * 100).toFixed(1)}%` },
];

/** One page for management: the short version, the key numbers, what to do next, and the same video compared across platforms. */
export default function Overview() {
  const origin = useOrigin();
  const me = useMe();
  const [f, setF] = useState(defaultFilters);
  const [metric, setMetric] = useState('views');
  const [running, setRunning] = useState(false);
  const { data, error, loading } = useApi<any>(withOrigin(`/api/analytics/overview?${filterQuery(f)}`, origin), [origin]);
  const briefApi = useApi<any>(withOrigin('/api/brief', origin), [origin]);
  const brief = briefApi.data?.brief;
  const update = async () => { setRunning(true); try { await api('/api/insights/run', { body: { scope: origin } }); await briefApi.reload(); } finally { setRunning(false); } };
  const stale = data?.freshness?.filter((a: any) => a.stale) ?? [];
  const byP = (code: string) => data?.content_by_platform?.find((c: any) => c.platform_code === code);
  const fol = (code: string) => data?.followers?.find((c: any) => c.platform_code === code);
  const noAccounts = data && data.freshness.length === 0;
  const m = METRICS.find((x) => x.key === metric)!;
  const wins = brief?.wins?.length ? brief.wins : null;
  const problems = brief?.problems?.length ? brief.problems : null;

  return (
    <>
      <PageHeader title="Overview" subtitle={data ? `${fmt.date(data.range.from)} – ${fmt.date(data.range.to)}${briefApi.data ? ` · analysis updated ${fmt.ago(briefApi.data.created_at)}` : ''}` : undefined}
        actions={can(me, 'analysis.run') && !noAccounts && <Button onClick={update} disabled={running}>{running ? 'Updating…' : 'Update analysis'}</Button>} />
      <ErrorBox error={error} />
      {loading && !data && <Loading />}

      {noAccounts && (
        <Card>
          <div className="py-4 text-sm text-ink-2 space-y-2">
            <div className="text-base font-medium text-ink">No {origin === 'live' ? '' : 'demo '}social accounts are connected yet</div>
            <p>Connect Instagram, Facebook and YouTube in <Link className="underline font-medium text-ink" to="/integrations">Integrations</Link>. Once posts are synced, this page shows the key numbers, what to do next and how each video does on every platform.</p>
            {origin === 'live' && <p>To look around first, switch to <b>Demo data</b> at the top right.</p>}
          </div>
        </Card>
      )}

      {data && !noAccounts && (
        <div className="space-y-5">
          <Filters value={f} onChange={setF} show={['range', 'platform']} />
          {stale.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              <b>Not up to date:</b> {stale.map((s: any) => `${s.display_name} (synced ${fmt.ago(s.last_synced_at)})`).join(', ')}. <Link className="underline" to="/integrations">Check integrations</Link>
            </div>
          )}

          <section className="bg-white border border-stone-200 rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">The short version</div>
            <p className="text-lg leading-snug font-medium text-ink">{brief?.headline ?? 'No analysis yet. Press "Update analysis" once posts are synced and linked to their videos.'}</p>
            {brief?.trend && <p className="text-sm text-ink-2 mt-2"><span className="font-medium text-ink">Over time — </span>{brief.trend}</p>}
          </section>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Views" value={fmt.n(data.combined.views)} sub={`${fmt.n(data.combined.published)} posts in the period`} hint={data.combined.views_note} />
            <Stat label="Likes, comments, shares, saves" value={fmt.n(data.combined.engagement)} />
            <Stat label="Shares and saves" value={fmt.n(data.combined.shares_saves)} sub="people passing it on or keeping it" />
            <Stat label="Time spent watching" value={fmt.sec(data.combined.watch_time_sec)} sub="where the platform reports it" />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="What to do next" subtitle="From your own videos' results, most important first" actions={<Link to="/insights" className="text-xs underline text-ink-2">All findings</Link>}>
              {!brief?.actions?.length ? <div className="text-sm text-ink-3">No clear action yet: more videos are needed before a pattern can be trusted.</div> : (
                <ol className="space-y-3">{brief.actions.slice(0, 3).map((a: any, i: number) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-ink text-white text-xs flex items-center justify-center font-semibold">{i + 1}</span>
                    <div><div className="text-sm font-medium leading-snug">{String(a.action).replace(/^For the next videos: (.)/, (_: string, c: string) => c.toUpperCase())}</div><div className="text-xs text-ink-2 mt-0.5">Why: {a.title}.</div><div className="mt-1"><CertaintyBadge c={a.certainty} /></div></div>
                  </li>))}</ol>)}
            </Card>
            <Card title="Best and weakest videos" subtitle={wins || problems ? 'Compared with what is expected for their platform and length' : 'Compared with other posts on the same platform'}>
              <VideoList title="Doing well" items={wins ?? data.top_content.slice(0, 3)} graded={!!wins} />
              <div className="h-3" />
              <VideoList title="Needs attention" items={problems ?? data.needs_attention.slice(0, 3)} graded={!!problems} />
            </Card>
          </div>

          <Card title="The same video on every platform" subtitle="Videos posted on two or more platforms in the period. Each platform counts views its own way."
            actions={<div className="inline-flex rounded-lg border border-stone-300 overflow-hidden text-xs">{METRICS.map((x) => (
              <button key={x.key} onClick={() => setMetric(x.key)} className={`px-2.5 py-1 ${metric === x.key ? 'bg-ink text-white' : 'bg-white text-ink-2'}`}>{x.label}</button>))}</div>}>
            {!data.cross_platform.length ? <div className="text-sm text-ink-3 py-4">No video is posted on more than one platform in this period yet. Studio videos are linked automatically; other posts can be linked in the <Link className="underline" to="/content">Content library</Link>.</div> : (
              <Chart height={300} option={{
                legend: { data: PLATFORMS.map((p) => PLATFORM_NAMES[p]), top: 0, textStyle: { color: '#52514e' } },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => m.format(v) },
                grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
                xAxis: { type: 'category', data: data.cross_platform.map((c: any) => c.content_code ?? c.title.slice(0, 18)), ...axisStyle },
                yAxis: { type: 'value', ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: m.axis } },
                series: PLATFORMS.map((p) => ({ name: PLATFORM_NAMES[p], type: 'bar', barMaxWidth: 22, color: PLATFORM_COLORS[p], itemStyle: { borderRadius: [3, 3, 0, 0] },
                  data: data.cross_platform.map((c: any) => c.platforms[p]?.[metric] ?? null) })),
              }} />)}
            {data.cross_platform.length > 0 && <div className="text-[11px] text-ink-3 mt-2">{data.cross_platform.map((c: any) => <span key={c.content_item_id} className="mr-3"><Link className="hover:underline" to={`/content/${c.content_item_id}`}><b>{c.content_code}</b> {c.title}</Link></span>)}</div>}
          </Card>

          <Card title="Platforms side by side">
            <Table rows={PLATFORMS.map((p) => ({ p, c: byP(p), fo: fol(p) }))} columns={[
              { key: 'p', label: 'Platform', render: (r) => <PlatformTag code={r.p} /> },
              { key: 'fo', label: 'Followers', align: 'right', render: (r) => fmt.n(r.fo?.followers) },
              { key: 'g', label: 'Growth', align: 'right', render: (r) => (r.fo?.growth_complete ? `${r.fo.growth >= 0 ? '+' : ''}${fmt.n(r.fo.growth)}` : '—') },
              { key: 'pub', label: 'Posts', align: 'right', render: (r) => fmt.n(r.c?.published ?? 0) },
              { key: 'v', label: 'Views', align: 'right', render: (r) => <span title={r.c?.views_definition}>{fmt.n(r.c?.views)}</span> },
              { key: 'e', label: 'Engagement rate', align: 'right', render: (r) => fmt.pct(r.c?.engagement_rate, 2) },
              { key: 'w', label: 'Watch time', align: 'right', render: (r) => fmt.sec(r.c?.watch_time_sec) },
            ]} />
          </Card>
        </div>
      )}
    </>
  );
}

function VideoList({ title, items, graded }: { title: string; items: any[]; graded: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1.5">{title}</div>
      {!items.length ? <div className="text-sm text-ink-3">Nothing stands out yet.</div> : (
        <ul className="space-y-2">{items.map((w: any) => (
          <li key={w.publication_id} className="flex gap-2 items-start text-sm">
            {graded && <GradeBadge grade={w.grade} />}
            <div className="min-w-0">
              <Link to={`/publication/${w.publication_id}`} className="font-medium hover:underline">{w.title}</Link> <PlatformTag code={w.platform} />
              <div className="text-xs text-ink-2">{graded ? w.text : `${fmt.n(w.views)} views · ${fmt.pct(w.avg_view_ratio, 0)} watched · ${fmt.pct(w.engagement_rate, 1)} engagement`}</div>
            </div>
          </li>))}</ul>)}
    </div>
  );
}
