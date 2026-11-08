import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fmt, PLATFORM_COLORS, PLATFORM_NAMES, useApi, useOrigin, withOrigin } from '../lib';
import { axisStyle, Card, Chart, ErrorBox, Loading, MetricValue, PageHeader, Table } from '../components/ui';
import { defaultFilters, filterQuery, Filters } from '../components/Filters';

export default function Platform() {
  const { code = 'instagram' } = useParams();
  const origin = useOrigin();
  const [f, setF] = useState({ ...defaultFilters, days: '90' });
  const { data, error, loading } = useApi<any>(withOrigin(`/api/analytics/platform/${code}?${filterQuery(f)}`, origin), [origin, code]);
  const color = PLATFORM_COLORS[code];
  const metricSeries = (k: string) => (data?.daily ?? []).filter((d: any) => d.metric_key === k);
  const audience = (dim: string) => (data?.audience ?? []).filter((a: any) => a.dimension === dim).slice(0, 10);
  const dims = [...new Set((data?.audience ?? []).map((a: any) => a.dimension))] as string[];
  return (
    <>
      <PageHeader title={`${PLATFORM_NAMES[code]} analytics`} subtitle={data?.views_definition} />
      <Filters value={f} onChange={setF} show={['range']} />
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title={code === 'youtube' ? 'Subscribers' : 'Followers'} subtitle="Account growth (each observation kept as a snapshot)">
              <Chart option={{ legend: false, xAxis: { type: 'category', data: data.followers.map((x: any) => x.day), ...axisStyle }, yAxis: { type: 'value', scale: true, ...axisStyle },
                series: [{ type: 'line', name: 'Followers', showSymbol: false, color, lineStyle: { width: 2 }, data: data.followers.map((x: any) => x.value) }] }} />
            </Card>
            <Card title="Views and reach per day" subtitle="Account-level daily values (reach is not summed across days as unique people)">
              <Chart option={{
                xAxis: { type: 'category', data: metricSeries('views').map((x: any) => x.day), ...axisStyle },
                yAxis: { type: 'value', ...axisStyle },
                series: [
                  { type: 'line', name: 'Views', showSymbol: false, color, lineStyle: { width: 2 }, data: metricSeries('views').map((x: any) => x.value) },
                  ...(metricSeries('reach').length ? [{ type: 'line', name: 'Reach', showSymbol: false, color: '#52514e', lineStyle: { width: 2, type: 'dashed' }, data: metricSeries('views').map((v: any) => metricSeries('reach').find((r: any) => r.day === v.day)?.value ?? null) }] : []),
                ],
              }} />
            </Card>
            <Card title="Publishing frequency" subtitle="Posts per week">
              <Chart option={{ legend: false, xAxis: { type: 'category', data: data.frequency.map((x: any) => x.week), ...axisStyle }, yAxis: { type: 'value', minInterval: 1, ...axisStyle },
                series: [{ type: 'bar', name: 'Posts', color, barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: data.frequency.map((x: any) => x.posts) }] }} />
            </Card>
            <Card title="Engagement trend" subtitle="Median engagement rate of posts, by publishing week">
              <Chart option={{ legend: false, tooltip: { valueFormatter: (v: number) => `${(v * 100).toFixed(2)}%` }, xAxis: { type: 'category', data: data.engagement_trend.map((x: any) => x.week), ...axisStyle },
                yAxis: { type: 'value', ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } },
                series: [{ type: 'line', name: 'Median engagement rate', color, symbolSize: 8, lineStyle: { width: 2 }, data: data.engagement_trend.map((x: any) => x.median_engagement_rate) }] }} />
            </Card>
          </div>
          {dims.length > 0 && (
            <Card title="Audience insights" subtitle="Latest breakdowns provided by the platform">
              <div className="grid md:grid-cols-3 gap-6">
                {dims.map((d) => (
                  <div key={d}><div className="text-xs font-medium text-ink-2 mb-2">{fmt.label(d)}</div>
                    {audience(d).map((a: any) => (
                      <div key={a.bucket} className="flex items-center gap-2 text-sm py-0.5">
                        <span className="w-28 truncate text-ink-2" title={a.bucket}>{a.bucket}</span>
                        <div className="flex-1 bg-stone-100 rounded h-2"><div className="h-2 rounded" style={{ width: `${(100 * a.value) / Math.max(...audience(d).map((x: any) => x.value))}%`, background: color }} /></div>
                        <span className="w-14 text-right tabular-nums text-xs">{a.unit === 'percent' ? `${(+a.value).toFixed(1)}%` : fmt.n(a.value)}</span>
                      </div>))}
                  </div>))}
              </div>
            </Card>
          )}
          <Card title="Publications" subtitle="Best performers first by watch share">
            <Table rows={[...data.publications].sort((a: any, b: any) => (b.avg_view_ratio ?? -1) - (a.avg_view_ratio ?? -1))} columns={[
              { key: 'title', label: 'Publication', render: (r) => <Link className="hover:underline" to={`/publication/${r.publication_id}`}>{r.content_code && <span className="text-ink-3 mr-1">{r.content_code}</span>}{r.title}</Link> },
              { key: 'format', label: 'Format', render: (r) => fmt.label(r.format) },
              { key: 'published_at', label: 'Published', render: (r) => fmt.date(r.published_at) },
              { key: 'views', label: 'Views', align: 'right', render: (r) => <MetricValue value={r.views} availability={r.availability.views} /> },
              { key: 'reach', label: 'Reach', align: 'right', render: (r) => <MetricValue value={r.reach} availability={r.availability.reach} /> },
              { key: 'er', label: 'Eng. rate', align: 'right', render: (r) => fmt.pct(r.engagement_rate, 2) },
              { key: 'avr', label: 'Watched', align: 'right', render: (r) => fmt.pct(r.avg_view_ratio, 0) },
              { key: 'r3', label: '3s retention', align: 'right', render: (r) => (r.retention_3s == null ? <span className="text-ink-3 text-xs" title="Requires a retention curve (not provided by the Instagram API)">n/a</span> : fmt.pct(r.retention_3s, 0)) },
            ]} />
          </Card>
        </div>
      )}
    </>
  );
}
