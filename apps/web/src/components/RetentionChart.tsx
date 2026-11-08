import { Chart, axisStyle } from './ui';
import { PLATFORM_COLORS, PLATFORM_NAMES } from '../lib';

const SEG_FILL = ['rgba(42,120,214,0.06)', 'rgba(0,0,0,0.025)'];

/**
 * Retention timeline: one line per platform curve (normalised to the first point = 100% of starters),
 * segment bands behind, drop-off markers on top. Connects video content (segments) to audience behaviour.
 */
export function RetentionChart({ curves, segments, dropOffs, duration, height = 300 }: {
  curves: { platform_code: string; points: { r: number; t: number | null; v: number }[]; duration_sec?: number | null }[];
  segments?: { segment_code: string; label: string; start_sec: number; end_sec: number }[];
  dropOffs?: { at_sec: number; loss: number }[];
  duration?: number | null;
  height?: number;
}) {
  const dur = duration ?? curves.find((c) => c.duration_sec)?.duration_sec ?? null;
  const series: any[] = curves.map((c) => {
    const base = c.points[0]?.v || 1;
    return {
      name: PLATFORM_NAMES[c.platform_code] ?? c.platform_code, type: 'line', showSymbol: false, lineStyle: { width: 2 }, color: PLATFORM_COLORS[c.platform_code],
      data: c.points.map((p) => [dur ? +(p.r * dur).toFixed(2) : p.r, +(p.v / base).toFixed(4)]),
    };
  });
  if (segments?.length && series[0]) {
    series[0].markArea = {
      silent: true, label: { show: true, position: 'insideTop', color: '#52514e', fontSize: 10 },
      data: segments.map((s, i) => [{ name: s.label, xAxis: dur ? s.start_sec : s.start_sec, itemStyle: { color: SEG_FILL[i % 2] } }, { xAxis: s.end_sec }]),
    };
  }
  if (dropOffs?.length && series[0]) {
    series[0].markLine = { symbol: 'none', silent: true, lineStyle: { color: '#e34948', type: 'dashed', width: 1 }, label: { show: false },
      data: dropOffs.map((d) => ({ xAxis: d.at_sec })) };
  }
  return (
    <>
    <Chart height={height} option={{
      legend: curves.length > 1 ? {} : false,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${(v * 100).toFixed(1)}%` },
      xAxis: { type: 'value', name: dur ? 'seconds' : 'share of video', nameLocation: 'middle', nameGap: 26, min: 0, max: dur ?? 1, ...axisStyle },
      yAxis: { type: 'value', min: 0, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series,
    }} />
    {dropOffs?.length ? <p className="text-xs text-ink-2 mt-1"><span className="text-red-600">┆</span> Steepest drop-offs: {dropOffs.map((d) => `${d.at_sec}s (−${(d.loss * 100).toFixed(1)} pts)`).join(', ')}</p> : null}
    </>
  );
}
