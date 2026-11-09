import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, can, fmt, PLATFORM_COLORS, PLATFORM_NAMES, useApi } from '../lib';
import { axisStyle, Badge, Button, Card, Chart, ErrorBox, Field, inputCls, Loading, MetricValue, PageHeader, PlatformTag, Table, Tabs } from '../components/ui';
import { RetentionChart } from '../components/RetentionChart';
import { useMe } from '../main';

const COMPARE = [
  ['views', 'Views', fmt.n], ['reach', 'Reach', fmt.n], ['impressions', 'Impressions', fmt.n], ['avg_watch_time_sec', 'Avg watch time', fmt.sec],
  ['total_watch_time_sec', 'Total watch time', fmt.sec], ['likes', 'Likes', fmt.n], ['reactions', 'Reactions', fmt.n], ['comments', 'Comments', fmt.n],
  ['shares', 'Shares', fmt.n], ['saves', 'Saves', fmt.n], ['profile_visits', 'Profile visits', fmt.n], ['follows', 'Follows', fmt.n],
  ['clicks', 'Clicks', fmt.n], ['subscribers_gained', 'Subscribers gained', fmt.n], ['ctr', 'Impressions CTR', (v: number) => fmt.pct(v, 1)],
  ['skip_rate', 'Skipped in first 3 s', (v: number) => `${Math.round(v > 1 ? v : v * 100)}%`],
] as const;
const FEATURE_OPTIONS: Record<string, string[]> = {
  opening_style: ['product_demo_first', 'problem_first', 'question', 'company_intro', 'slow_cinematic', 'direct_statement', 'unknown'],
  product_shown_in_opening: ['yes', 'no', 'unknown'], opening_has_narration: ['yes', 'no'], cta_type: ['website', 'enquiry', 'purchase', 'follow', 'dm', 'none', 'unknown'],
  editing_pace: ['slow', 'medium', 'fast'], hook_type: ['question', 'problem', 'demo', 'company_intro', 'statement', 'none', 'unknown'],
};

export default function ContentDetail() {
  const { id } = useParams();
  const me = useMe();
  const { data, error, reload } = useApi<any>(`/api/content/${id}`, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { item, publications, analysis, segments, features, curves } = data;
  const s = analysis?.summary;
  const isDemo = item.data_origin === 'demo';
  return (
    <>
      <PageHeader title={item.title} subtitle={<span className="flex flex-wrap gap-2 items-center"><span className="font-mono">{item.code}</span>{isDemo && <Badge color="amber">DEMO</Badge>}{item.category && <Badge>{item.category}</Badge>}{item.product && <Badge>{item.product}</Badge>}{item.campaign && <Badge color="blue">{item.campaign}</Badge>}</span>} />
      <div className="space-y-5">
        <Card title="Same content across platforms" subtitle="Each value uses that platform's own metric definition; unavailable metrics are never shown as zero">
          {publications.length ? (
            <Table rows={COMPARE.filter(([k]) => publications.some((p: any) => p.metrics[k]))} columns={[
              { key: 'm', label: 'Metric', render: (r) => r[1] },
              ...publications.map((p: any) => ({ key: p.id, align: 'right' as const, label: <Link to={`/publication/${p.id}`} className="hover:underline"><PlatformTag code={p.platform_code} /> <span className="text-ink-3 ml-1">{p.publication_code}</span></Link>,
                render: (r: any) => <MetricValue value={p.metrics[r[0]]?.value} availability={p.metrics[r[0]]?.availability ?? 'unavailable'} format={r[2]} /> })),
            ]} />
          ) : <div className="text-sm text-ink-2">Not posted yet. Once it is posted (from the Studio, or by hand and linked at the bottom of the <Link className="underline" to="/content">Content library</Link>), every platform's numbers appear here side by side.</div>}
        </Card>

        <Card title="Audience retention timeline" subtitle="Share of starting viewers still watching, with content segments and steepest drop-offs. Instagram does not expose retention curves.">
          {curves.length ? <RetentionChart curves={curves} segments={segments} duration={analysis?.duration_sec ?? curves[0].duration_sec} /> : <div className="text-sm text-ink-2">No retention curve yet. YouTube and Facebook provide one after enough views; Instagram only provides average watch time.</div>}
        </Card>

        <Tabs tabs={[
          { key: 'structure', label: 'Opening · middle · ending', content: <Structure s={s} analysis={analysis} /> },
          { key: 'segments', label: 'Segments', content: <Segments segments={segments} /> },
          { key: 'features', label: 'Content features', content: <Features features={features} contentId={item.id} canEdit={can(me, 'content.edit') && !isDemo} reload={reload} /> },
          { key: 'transcript', label: 'Transcript & scenes', content: <Transcript analysis={analysis} /> },
          { key: 'media', label: 'Media & analysis', content: <Media data={data} canEdit={can(me, 'content.edit') && !isDemo} canRun={can(me, 'analysis.run') && !isDemo} reload={reload} /> },
        ]} />
      </div>
    </>
  );
}

const yn = (v: any) => (v === true ? <Badge color="green">Yes</Badge> : v === false ? <Badge>No</Badge> : <span className="text-ink-3 text-xs" title="Requires speech/vision analysis">unknown</span>);

function Structure({ s, analysis }: { s: any; analysis: any }) {
  if (!s) return <Card><div className="text-sm text-ink-2">{analysis ? `Analysis status: ${analysis.status}${analysis.error ? ` — ${analysis.error}` : ''}` : 'Upload the master video under "Media & analysis" to run video understanding.'}</div></Card>;
  const o = s.opening, m = s.middle, e = s.ending, ov = s.overall;
  const Row = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-4 py-1.5 border-b border-stone-100 last:border-0 text-sm"><span className="text-ink-2">{k}</span><span className="text-right">{v}</span></div>;
  return (
    <div className="space-y-4">
      {s.statuses && <div className="flex flex-wrap gap-2 text-xs">{Object.entries(s.statuses).map(([k, v]: any) => <Badge key={k} color={String(v).startsWith('ok') ? 'green' : 'gray'} title={v}>{k}: {String(v).split(':')[0]}</Badge>)}</div>}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Opening (0–5 s)">
          {['first_1s', 'first_3s', 'first_5s'].map((w) => (
            <div key={w} className="mb-3"><div className="text-xs font-medium text-ink-2">{w.replace('first_', 'First ').replace('s', ' s')}</div>
              <div className="text-sm">{o[w].speech ? `“${o[w].speech}”` : <span className="text-ink-3">no speech</span>}</div>
              {o[w].on_screen_text && <div className="text-xs text-ink-2">On screen: {o[w].on_screen_text}</div>}
              {o[w].visuals?.length > 0 && <div className="text-xs text-ink-2">Visual: {o[w].visuals.join(' / ')}</div>}
              <div className="text-[11px] text-ink-3">{o[w].scene_changes} cut(s)</div></div>))}
          <Row k="Begins with a question" v={yn(o.begins_with_question)} />
          <Row k="Begins with a problem statement" v={yn(o.begins_with_problem_statement)} />
          <Row k="Begins with product demonstration" v={yn(o.begins_with_product_demo)} />
          <Row k="Surprising visual" v={yn(o.begins_with_surprising_visual)} />
          <Row k="Introduces company immediately" v={yn(o.introduces_company_immediately)} />
          <Row k="Narration in opening" v={yn(o.uses_narration)} />
          <Row k="Text overlay" v={yn(o.uses_text_overlay)} />
          <Row k="Animation" v={yn(o.uses_animation)} />
          <Row k="Main subject clear by" v={o.subject_clear_by_sec != null ? `${o.subject_clear_by_sec} s` : <span className="text-ink-3 text-xs">needs vision model</span>} />
          <Row k="First speech at" v={o.first_speech_at_sec != null ? `${o.first_speech_at_sec} s` : '—'} />
        </Card>
        <Card title={`Middle (${m.range[0]}–${m.range[1]} s)`}>
          <Row k="Scene changes" v={m.scene_changes} />
          <Row k="Cuts per 10 s (whole video)" v={m.cuts_per_10s_overall} />
          <Row k="Longest single shot" v={`${m.longest_shot_sec} s`} />
          <Row k="Long explanations (>12 s, one shot)" v={m.long_explanations.length ? m.long_explanations.map((x: any) => `${x.start}–${x.end}s`).join(', ') : 'none'} />
          <Row k="Unnecessary pauses (>1.2 s)" v={m.unnecessary_pauses.length ? m.unnecessary_pauses.map((x: any) => `${x.start}–${x.end}s`).join(', ') : 'none'} />
          <Row k="Demonstrates product" v={yn(m.demonstrates_product)} />
          <Row k="Educational elements" v={yn(m.educational_elements)} />
          <Row k="Visual re-engagement points" v={m.visual_reengagement_points.length ? m.visual_reengagement_points.map((x: number) => `${x}s`).join(', ') : 'none'} />
        </Card>
        <Card title={`Ending (${e.range[0]}–${e.range[1]} s)`}>
          <div className="text-sm mb-3">{e.speech ? `“${e.speech}”` : <span className="text-ink-3">no speech</span>}</div>
          <Row k="Conclusion" v={yn(e.has_conclusion)} />
          <Row k="Product message" v={yn(e.has_product_message)} />
          <Row k="Call to action" v={e.has_cta ? e.cta_types.join(', ') : yn(false)} />
          <Row k="Points viewers to the website" v={yn(e.asks_to_visit_website)} />
          <Row k="Encourages enquiries" v={yn(e.encourages_enquiries)} />
          <Row k="Ends abruptly" v={yn(e.ends_abruptly)} />
          <Row k="Unnecessary closing footage" v={e.unnecessary_closing_footage_sec ? `${e.unnecessary_closing_footage_sec} s` : 'none'} />
        </Card>
      </div>
      <Card title="Overall">
        <div className="grid md:grid-cols-4 gap-x-6">
          <Row k="Duration" v={`${ov.duration_sec} s`} /><Row k="Aspect ratio" v={ov.aspect_ratio} /><Row k="Resolution" v={ov.resolution} /><Row k="Scenes" v={ov.scenes} />
          <Row k="Editing pace" v={fmt.label(ov.editing_pace)} /><Row k="Speech ratio" v={fmt.pct(ov.speech_ratio, 0)} /><Row k="Audio" v={fmt.label(ov.audio_type)} />
          <Row k="Loudness" v={ov.loudness_lufs != null ? <span title={ov.loudness_note}>{ov.loudness_lufs} LUFS</span> : '—'} />
        </div>
      </Card>
    </div>
  );
}

function Segments({ segments }: { segments: any[] }) {
  return <Card subtitle="Segment boundaries come from the configurable template (Settings → Segments), adjusted to the video length">
    <Table rows={segments} empty="No segments yet — run video analysis" columns={[
      { key: 'label', label: 'Segment' }, { key: 't', label: 'Time', render: (r) => `${r.start_sec}–${r.end_sec} s` },
      { key: 'transcript_text', label: 'Spoken', render: (r) => <span className="text-xs">{r.transcript_text || '—'}</span> },
      { key: 'scene_changes', label: 'Cuts', align: 'right' }, { key: 'speech_ratio', label: 'Speech', align: 'right', render: (r) => fmt.pct(r.speech_ratio, 0) },
      { key: 'silence_sec', label: 'Silence', align: 'right', render: (r) => `${(+r.silence_sec).toFixed(1)} s` },
      { key: 'obs', label: 'On screen / CTA words', render: (r) => <span className="text-xs text-ink-2">{[...(r.observations.on_screen_text ?? []), ...(r.observations.ctas ?? [])].join(', ') || '—'}</span> },
    ]} />
  </Card>;
}

function Features({ features, contentId, canEdit, reload }: { features: any[]; contentId: string; canEdit: boolean; reload: () => void }) {
  const save = async (key: string, v: string) => { await api(`/api/content/${contentId}/features/${key}`, { method: 'PUT', body: FEATURE_OPTIONS[key] || isNaN(Number(v)) ? { value_text: v } : { value_num: Number(v) } }); reload(); };
  return <Card subtitle="Structured metadata used for cross-video comparison. Correct anything the AI got wrong — human corrections are never overwritten by re-analysis.">
    <Table rows={features} columns={[
      { key: 'feature_key', label: 'Feature', render: (r) => fmt.label(r.feature_key) },
      { key: 'v', label: 'Value', render: (r) => canEdit && FEATURE_OPTIONS[r.feature_key]
        ? <select className={`${inputCls} !w-auto !py-1`} value={r.value_text ?? ''} onChange={(e) => save(r.feature_key, e.target.value)}>{FEATURE_OPTIONS[r.feature_key].map((o) => <option key={o} value={o}>{fmt.label(o)}</option>)}</select>
        : (r.value_text ? fmt.label(r.value_text) : r.value_num) },
      { key: 'source', label: 'Source', render: (r) => <Badge color={r.source === 'human' ? 'green' : r.source === 'ai' ? 'violet' : 'gray'}>{r.source}{r.corrected_by_name ? ` · ${r.corrected_by_name}` : ''}</Badge> },
      { key: 'confidence', label: 'Confidence', align: 'right', render: (r) => (r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—') },
    ]} />
  </Card>;
}

function Transcript({ analysis }: { analysis: any }) {
  if (!analysis?.transcript) return <Card><div className="text-sm text-ink-2">No transcript yet.</div></Card>;
  const dur = +analysis.duration_sec;
  return <div className="grid lg:grid-cols-2 gap-4">
    <Card title="Transcript">
      <div className="space-y-1.5 text-sm max-h-96 overflow-y-auto">{analysis.transcript.length ? analysis.transcript.map((t: any, i: number) => <div key={i}><span className="text-ink-3 font-mono text-xs mr-2">{t.start.toFixed(1)}s</span>{t.text}</div>) : <span className="text-ink-2">No speech detected.</span>}</div>
    </Card>
    <Card title="Scenes & pauses" subtitle="Shot boundaries (FFmpeg scene detection) and silences">
      <Chart height={160} option={{ legend: false, tooltip: { trigger: 'item' }, grid: { left: 70 },
        xAxis: { type: 'value', min: 0, max: dur, ...axisStyle, name: 'seconds', nameLocation: 'middle', nameGap: 24 },
        yAxis: { type: 'category', data: ['Pauses', 'Scenes'], ...axisStyle },
        series: [{ type: 'custom', renderItem: (_p: any, api: any) => {
          const y = api.value(0), a = api.coord([api.value(1), y]), b = api.coord([api.value(2), y]), h = api.size([0, 1])[1] * 0.5;
          return { type: 'rect', shape: { x: a[0] + 1, y: a[1] - h / 2, width: Math.max(1, b[0] - a[0] - 2), height: h, r: 3 }, style: { fill: api.value(0) === 1 ? '#2a78d6' : '#a8a29e' } };
        }, encode: { x: [1, 2], y: 0 }, data: [...analysis.scenes.map((s: any) => [1, s.start, s.end]), ...analysis.silences.map((s: any) => [0, s.start, s.end ?? dur])] }] }} />
      <div className="text-xs text-ink-2 mt-2">{analysis.scenes.length} scenes, {analysis.silences.length} pauses</div>
    </Card>
  </div>;
}

function Media({ data, canEdit, canRun, reload }: { data: any; canEdit: boolean; canRun: boolean; reload: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [srt, setSrt] = useState('');
  const upload = async () => {
    const f = fileRef.current?.files?.[0]; if (!f) return;
    const form = new FormData(); form.append('asset_type', 'master_video'); form.append('file', f);
    setBusy(true); setMsg(null);
    try { const r = await api('/api/content/' + data.item.id + '/assets', { form }); setMsg(r.duplicate ? 'This exact file was already uploaded.' : 'Uploaded — analysis queued. Refresh in a minute.'); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="grid lg:grid-cols-2 gap-4">
    <Card title="Media files">
      <Table rows={data.assets} empty="No files yet" columns={[
        { key: 'asset_type', label: 'Type', render: (r) => fmt.label(r.asset_type) }, { key: 'duration_sec', label: 'Duration', render: (r) => (r.duration_sec ? `${(+r.duration_sec).toFixed(1)} s` : '—') },
        { key: 'res', label: 'Resolution', render: (r) => (r.width ? `${r.width}×${r.height}` : '—') }, { key: 'size_bytes', label: 'Size', render: (r) => (r.size_bytes ? `${(r.size_bytes / 1e6).toFixed(1)} MB` : '—') },
        { key: 'created_at', label: 'Added', render: (r) => fmt.dt(r.created_at) },
      ]} />
      {canEdit && <div className="mt-4 flex flex-wrap gap-2 items-center"><input ref={fileRef} type="file" accept="video/*" className="text-sm" /><Button variant="primary" onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload master video'}</Button></div>}
      {msg && <div className="text-sm text-ink-2 mt-2">{msg}</div>}
    </Card>
    <Card title="Video analysis" actions={canRun && <Button onClick={async () => { await api(`/api/content/${data.item.id}/analyze`, { method: 'POST' }); setMsg('Analysis queued.'); }}>Re-run analysis</Button>}>
      {data.analysis ? <div className="text-sm space-y-1"><div>Status: <Badge color={data.analysis.status === 'succeeded' ? 'green' : data.analysis.status === 'failed' ? 'red' : 'amber'}>{data.analysis.status}</Badge></div>
        <div className="text-ink-2">Analyzer {data.analysis.analyzer_version ?? ''} · {fmt.dt(data.analysis.finished_at ?? data.analysis.created_at)}</div>
        {data.analysis.error && <ErrorBox error={data.analysis.error} />}</div> : <div className="text-sm text-ink-2">Not analysed yet.</div>}
      {canEdit && <div className="mt-4"><Field label="Optional: paste subtitles (SRT/VTT) instead of automatic speech recognition"><textarea className={`${inputCls} h-24 font-mono text-xs`} value={srt} onChange={(e) => setSrt(e.target.value)} /></Field>
        <div className="mt-2"><Button small onClick={async () => { await api(`/api/content/${data.item.id}/transcript`, { body: { text: srt } }); setMsg('Subtitles saved — re-run analysis to use them.'); }} disabled={srt.length < 5}>Save subtitles</Button></div></div>}
    </Card>
  </div>;
}
export { PLATFORM_COLORS, PLATFORM_NAMES };
