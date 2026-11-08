/**
 * Resilient HTTP client for platform APIs:
 *  - retries with exponential backoff + jitter on 429 / 5xx / network errors
 *  - honours Retry-After
 *  - per-host concurrency + minimum spacing (simple rate limiter)
 *  - never logs tokens
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
    public url: string,
    public code?: string | number,
  ) {
    super(message);
  }
}

type Limiter = { last: number; active: number; queue: (() => void)[] };
const limiters = new Map<string, Limiter>();
const MIN_SPACING_MS: Record<string, number> = {
  'graph.facebook.com': 120,
  'graph.instagram.com': 120,
  'youtubeanalytics.googleapis.com': 100,
  'www.googleapis.com': 50,
  'youtubereporting.googleapis.com': 100,
  'analyticsdata.googleapis.com': 100,
};
const MAX_CONCURRENCY = 4;

async function acquire(host: string) {
  let l = limiters.get(host);
  if (!l) { l = { last: 0, active: 0, queue: [] }; limiters.set(host, l); }
  if (l.active >= MAX_CONCURRENCY) await new Promise<void>((r) => l!.queue.push(r));
  l.active++;
  const spacing = MIN_SPACING_MS[host] ?? 50;
  const wait = l.last + spacing - Date.now();
  if (wait > 0) await sleep(wait);
  l.last = Date.now();
}
function release(host: string) {
  const l = limiters.get(host)!;
  l.active--;
  l.queue.shift()?.();
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const redact = (url: string) => url.replace(/(access_token|client_secret|key)=[^&]+/g, '$1=***');

export interface RequestOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  retries?: number;
  form?: Record<string, string>;
  raw?: boolean; // return text
}

export async function request<T = any>(url: string, opts: RequestOpts = {}): Promise<T> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 4;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await acquire(host);
    let res: Response;
    try {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      let body: any = undefined;
      if (opts.form) {
        body = new URLSearchParams(opts.form).toString();
        headers['content-type'] = 'application/x-www-form-urlencoded';
      } else if (opts.body !== undefined) {
        body = JSON.stringify(opts.body);
        headers['content-type'] = 'application/json';
      }
      res = await fetch(url, { method: opts.method ?? 'GET', headers, body, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      release(host);
      if (attempt++ < retries) { await sleep(backoff(attempt)); continue; }
      throw new ApiError(`Network error: ${(e as Error).message}`, 0, null, redact(url));
    }
    release(host);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }

    if (res.ok) return (opts.raw ? text : json) as T;

    const retryable = res.status === 429 || res.status >= 500 || isMetaThrottle(json);
    if (retryable && attempt++ < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
      continue;
    }
    const msg = json?.error?.message ?? json?.error_description ?? text?.slice(0, 300) ?? res.statusText;
    throw new ApiError(msg, res.status, json, redact(url), json?.error?.code ?? json?.error?.status);
  }
}

function backoff(attempt: number) {
  return Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 300;
}

// Meta rate-limit error codes: 4 (app), 17 (user), 32 (page), 613, 80001-80014 (BUC)
function isMetaThrottle(json: any) {
  const c = json?.error?.code;
  return [4, 17, 32, 613].includes(c) || (typeof c === 'number' && c >= 80001 && c <= 80014);
}
