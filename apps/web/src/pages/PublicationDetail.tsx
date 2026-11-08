import { Link, useParams } from 'react-router-dom';
import { fmt, PLATFORM_COLORS, useApi } from '../lib';
import { axisStyle, Badge, Card, CertaintyBadge, Chart, Disclosure, ErrorBox, GradeBadge, Loading, MetricValue, PageHeader, PlatformTag, Table } from '../components/ui';
import { RetentionChart } from '../components/RetentionChart';

const UNIT_FMT: Record<string, (v: number) => string> = { seconds: fmt.sec, ratio: (v) => fmt.pct(v, 2), percent: (v) => `${v.toFixed(1)}%` };

export default function PublicationDetail() {
  const { id } = useParams();
  const { data, error } = useApi<any>(`/api/publications/${id}`, [id]);
  const ex = useApi<any>(`/api/publications/${id}/explain`, [id]).data;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.publication;
  const hist = data.history.filter((h: any) => h.metric_key === 'views' && h.value != null);
  const t = ex?.technical;
  const segs = t?.segments?.map((s: any) => ({ segment_code: s.code, label: s.label, start_sec: s.start, end_sec: s.end })) ?? [];
  return (
    <>
      <PageHeader title={p.title ?? p.caption?.split('\n')[0] ?? p.platform_post_id}
        subtitle={<span className="flex flex-wrap gap-3 items-center"><PlatformTag code={p.platform_code} /><span>{fmt.label(p.format)}</span><span>Published {fmt.dt(p.published_at)}</span>
          {p.content_code && <Link to={`/content/${p.content_item_id}`} className="underline">{p.content_code} — {p.content_title}</Link>}
          {p.data_origin === 'demo' && <Badge color="amber">DEMO</Badge>}{p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="underline">Open on platform ↗</a>}
          <span className="text-ink-3">Last synced {fmt.ago(p.last_synced_at)}</span></span>} />
      <div className="space-y-5">
        {ex && <ReportCard ex={ex} />}

        <Card title="When viewers left" subtitle={t?.curve_resolution_sec ? `Share of starting viewers still watching, second by second (one data point every ${t.curve_resolution_sec} s). Shaded bands are the parts of the video.` : undefined}>
          {data.curve ? <>
            <RetentionChart curves={[{ platform_code: p.platform_code, points: data.curve.points, duration_sec: data.curve.duration_sec }]} segments={segs} dropOffs={t?.drop_offs} />
            {t?.segments?.length > 0 && <ul className="mt-3 space-y-1 text-sm text-ink">{t.segments.filter((s: any) => s.plain).map((s: any) => <li key={s.code}>• {s.plain}</li>)}</ul>}
            <Disclosure>
              <Table rows={t?.segments ?? []} columns={[
                { key: 'label', label: 'Part' }, { key: 't', label: 'Time', render: (r) => `${r.start}–${r.end}s` },
                { key: 'start_retention', label: 'Viewers at start', align: 'right', render: (r) => fmt.pct(r.start_retention, 0) },
                { key: 'relative_drop', label: 'Left during it', align: 'right', render: (r) => fmt.pct(r.relative_drop, 0) },
                { key: 'rate', label: 'Loss per second (this / similar videos)', align: 'right', render: (r) => `${fmt.pct(r.loss_rate, 1)} / ${fmt.pct(r.cohort_loss_rate, 1)}` },
                { key: 'rewatch', label: 'Rewatched', render: (r) => (r.rewatch ? <Badge color="blue">yes</Badge> : '—') },
              ]} />
            </Disclosure>
          </> : <div className="text-sm text-ink-2">{p.platform_code === 'instagram' ? 'Instagram does not share second-by-second viewer data — only how long people watched on average.' : 'No second-by-second viewer data yet (platforms only report it once a video has enough views).'}</div>}
        </Card>

        <div className="grid lg:grid-cols-2 gap-5">
          <Card title="All numbers from the platform" subtitle="Latest value of each metric, with the platform's own name for it">
            <Table rows={data.metrics} columns={[
              { key: 'metric_key', label: 'Metric', render: (r) => <span title={r.description}>{fmt.label(r.metric_key)}{r.platform_metric && <span className="text-ink-3 text-[11px] ml-1 font-mono">{r.platform_metric}</span>}</span> },
              { key: 'value', label: 'Value', align: 'right', render: (r) => <MetricValue value={r.value} availability={r.availability} format={UNIT_FMT[r.unit] ?? fmt.n} /> },
              { key: 'collected_at', label: 'Collected', render: (r) => <span className="text-xs text-ink-2">{fmt.dt(r.collected_at)}</span> },
            ]} />
          </Card>
          <Card title="Views over time" subtitle="Each sync is kept, so you can see how fast the video picked up views">
            {hist.length > 1 ? <Chart option={{ legend: false, xAxis: { type: 'time', ...axisStyle, axisLabel: { ...axisStyle.axisLabel, hideOverlap: true, formatter: '{d} {MMM}' } }, yAxis: { type: 'value', ...axisStyle },
              series: [{ type: 'line', name: 'Views', color: PLATFORM_COLORS[p.platform_code], symbolSize: 8, lineStyle: { width: 2 }, data: hist.map((h: any) => [h.collected_at, h.value]) }] }} />
              : <div className="text-sm text-ink-2">Only one observation so far — the line builds up with each scheduled sync.</div>}
          </Card>
        </div>
      </div>
    </>
  );
}

function ReportCard({ ex }: { ex: any }) {
  return (
    <Card title="Report card" subtitle={ex.how_sure} actions={<GradeBadge grade={ex.grade} words={ex.grade_words} />}>
      <p className="text-xl font-medium leading-snug text-ink">{ex.verdict}</p>
      {ex.position && <p className="text-sm text-ink-2 mt-1">{ex.position}</p>}
      <div className="grid lg:grid-cols-2 gap-6 mt-5">
        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">What happened</h3>
          <ul className="space-y-1.5 text-[15px] leading-relaxed">{ex.story.map((s: string) => <li key={s}>• {s}</li>)}</ul>
          {ex.diagnosis && <p className="mt-3 text-[15px] bg-stone-50 rounded-lg p-3"><strong>Diagnosis:</strong> {ex.diagnosis}</p>}
        </div>
        <div>
          <h3 className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">What to change next time</h3>
          {ex.changes.length ? <ol className="space-y-3">{ex.changes.map((c: any, i: number) => (
            <li key={i} className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-ink text-white text-xs flex items-center justify-center font-semibold">{i + 1}</span>
              <div><div className="text-[15px] font-medium leading-snug">{c.change}</div><div className="text-sm text-ink-2 mt-0.5">{c.why}</div><div className="mt-1"><CertaintyBadge c={c.certainty} /></div></div></li>
          ))}</ol> : <p className="text-sm text-ink-2">Nothing specific — this video already follows the patterns that work in your other videos.</p>}
        </div>
      </div>
      {ex.moments.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">The moments people left</h3>
          <ul className="space-y-1.5 text-[15px]">{ex.moments.map((m: any) => <li key={m.at} className="flex gap-3"><span className="font-mono text-sm text-ink-2 w-20 shrink-0">{m.at}</span><span>{m.text}</span></li>)}</ul>
        </div>
      )}
      {(ex.strengths.length > 0 || ex.weaknesses.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          {ex.strengths.length > 0 && <div><h3 className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-2">Better than expected</h3><ul className="space-y-1 text-sm">{ex.strengths.map((s: string) => <li key={s}>▲ {s}</li>)}</ul></div>}
          {ex.weaknesses.length > 0 && <div><h3 className="text-[11px] uppercase tracking-wide text-amber-700 font-semibold mb-2">Worse than expected</h3><ul className="space-y-1 text-sm">{ex.weaknesses.map((s: string) => <li key={s}>▼ {s}</li>)}</ul></div>}
        </div>
      )}
      {ex.other_platforms.length > 0 && <div className="mt-6"><h3 className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-2">The same video elsewhere</h3>
        <ul className="space-y-1 text-sm">{ex.other_platforms.map((o: any) => <li key={o.publication_id}><Link className="hover:underline" to={`/publication/${o.publication_id}`}><PlatformTag code={o.platform} /></Link> {o.text}</li>)}</ul></div>}
      <Disclosure>
        <Table rows={ex.technical.comparisons} columns={[
          { key: 'label', label: 'Measure' }, { key: 'value', label: 'This video', align: 'right', render: (r) => fmt.pct(r.value, 1) },
          { key: 'cohort_median', label: 'Typical', align: 'right', render: (r) => fmt.pct(r.cohort_median, 1) },
          { key: 'percentile', label: 'Percentile', align: 'right', render: (r) => `${Math.round(r.percentile * 100)}th` }, { key: 'cohort_n', label: 'Compared with', align: 'right' },
        ]} />
      </Disclosure>
    </Card>
  );
}
