import { useCallback, useEffect, useState } from 'react';

export class HttpError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    credentials: 'include',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new HttpError(data?.error ?? res.statusText, res.status);
  return data as T;
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true); setError(null);
    try { setData(await api<T>(path)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Live vs demo data scope, persisted per browser. */
export function getOrigin(): 'live' | 'demo' { try { return localStorage.getItem('cip_origin') === 'demo' ? 'demo' : 'live'; } catch { return 'live'; } }
export function setOrigin(o: 'live' | 'demo') { try { localStorage.setItem('cip_origin', o); } catch { /* ignore */ } window.dispatchEvent(new Event('cip-origin')); }
export function useOrigin() {
  const [o, setO] = useState(getOrigin());
  useEffect(() => { const h = () => setO(getOrigin()); window.addEventListener('cip-origin', h); return () => window.removeEventListener('cip-origin', h); }, []);
  return o;
}
export const withOrigin = (path: string, origin: string) => `${path}${path.includes('?') ? '&' : '?'}origin=${origin}`;

// Categorical palette (validated reference palette, slots 1-3 pass all-pairs CVD checks). Colour follows the entity.
export const PLATFORM_COLORS: Record<string, string> = { instagram: '#2a78d6', facebook: '#eb6834', youtube: '#1baf7a', linkedin: '#6250d6', other: '#8a8984', all: '#52514e' };
export const PLATFORM_NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', other: 'Other', unknown: 'Unknown' };
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export const fmt = {
  n: (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString('en-US')),
  pct: (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`),
  sec: (v: number | null | undefined) => (v == null ? '—' : v >= 3600 ? `${(v / 3600).toFixed(1)} h` : v >= 60 ? `${(v / 60).toFixed(1)} min` : `${v.toFixed(1)} s`),
  date: (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'),
  dt: (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'),
  ago: (v: string | null | undefined) => {
    if (!v) return 'never';
    const h = (Date.now() - new Date(v).getTime()) / 36e5;
    return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
  },
  label: (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—'),
};

export interface Me { id: string; email: string; full_name: string; role: string; permissions: string[] }
export const can = (me: Me | null, ...p: string[]) => !!me && p.some((x) => me.permissions.includes(x));
