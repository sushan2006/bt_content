import { env } from '../config.js';
import { ApiError, request } from '../lib/http.js';
import type { Availability } from '../sync/writer.js';

export const graphBase = () => `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

export async function graph<T = any>(path: string, params: Record<string, string | number | undefined>, token: string): Promise<T> {
  const u = new URL(`${graphBase()}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  u.searchParams.set('access_token', token);
  return request<T>(u.toString());
}

/** Follow `paging.next` cursors up to `max` items. */
export async function graphPaged<T = any>(path: string, params: Record<string, string | number | undefined>, token: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let res: any = await graph(path, params, token);
  const seen = new Set<string>();
  while (true) {
    out.push(...(res.data ?? []));
    const next = res.paging?.next;
    if (out.length >= max || !next || seen.has(next) || !(res.data ?? []).length) break; // guard against cursor loops
    seen.add(next);
    res = await request(next);
  }
  return out.slice(0, max);
}

export function availabilityFromError(e: unknown): Availability {
  if (e instanceof ApiError) {
    const c = Number(e.code);
    if ([10, 200, 190].includes(c) || (c >= 200 && c < 300) || e.status === 403) return 'permission_missing';
    if (c === 100 || /metric|not supported|invalid/i.test(e.message)) return 'not_supported';
  }
  return 'error';
}

export interface MetricResult {
  value: number | null;
  availability: Availability;
  raw?: any;
  error?: string;
}

/** Extract a scalar from an insights row (sums object values such as reactions-by-type). */
export function insightValue(row: any): any {
  if (row?.total_value !== undefined) return row.total_value.value;
  const vals = row?.values;
  if (!vals?.length) return null;
  return vals[vals.length - 1].value;
}
export function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  if (typeof v === 'object') {
    const nums = Object.values(v).filter((x) => typeof x === 'number') as number[];
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  }
  return null;
}

/**
 * Request many insight metrics in one call; if Meta rejects the batch (one deprecated/unsupported metric fails
 * the whole request) fall back to one call per metric so the rest are still collected and the bad one is
 * recorded as not_supported instead of silently missing.
 */
export async function fetchInsights(
  objectId: string,
  edge: 'insights' | 'video_insights',
  metrics: string[],
  params: Record<string, string | number | undefined>,
  token: string,
): Promise<Map<string, MetricResult>> {
  const out = new Map<string, MetricResult>();
  const absorb = (rows: any[]) => {
    for (const r of rows) {
      const v = insightValue(r);
      out.set(r.name, { value: toNumber(v), availability: v === null ? 'unavailable' : 'available', raw: v });
    }
  };
  try {
    const res = await graph<any>(`${objectId}/${edge}`, { ...params, metric: metrics.join(',') }, token);
    absorb(res.data ?? []);
  } catch (e) {
    for (const m of metrics) {
      try {
        const res = await graph<any>(`${objectId}/${edge}`, { ...params, metric: m }, token);
        absorb(res.data ?? []);
      } catch (e2) {
        out.set(m, { value: null, availability: availabilityFromError(e2), error: (e2 as Error).message });
      }
    }
  }
  // Metric requested but absent from the response => Meta has no data for it (IG returns empty set instead of 0)
  for (const m of metrics) if (!out.has(m)) out.set(m, { value: null, availability: 'unavailable' });
  return out;
}

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'business_management',
  // Phase 2: publishing approved videos
  'instagram_content_publish',
  'pages_manage_posts',
];
