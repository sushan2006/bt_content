/** Client for the Python studio service (take selection, planning, rendering). */
import { env } from '../config.js';
import { sleep } from '../lib/http.js';

async function post<T = any>(path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`${env.ANALYZER_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    throw new Error(`The video service is not reachable at ${env.ANALYZER_URL} (${(e as Error).message}). Start it with RUN_DEMO.bat or "npm run analyzer".`);
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Video service error ${res.status}`);
  return data as T;
}

async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(`${env.ANALYZER_URL}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Video service error ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Task<T = any> { id: string; status: 'running' | 'done' | 'failed'; log: string[]; result: T | null; error: string | null }

/** Starts a background task and waits for it, reporting progress lines. */
async function runTask<T>(path: string, body: unknown, onLog?: (line: string) => void, maxMinutes = 120): Promise<T> {
  const { task_id } = await post<{ task_id: string }>(path, body);
  let seen = 0;
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const t = await get<Task<T>>(`/studio/tasks/${task_id}`);
    for (const line of t.log.slice(seen)) onLog?.(line);
    seen = t.log.length;
    if (t.status === 'done') return t.result as T;
    if (t.status === 'failed') throw new Error(t.error ?? 'task failed');
  }
  throw new Error('The video service took too long');
}

export const studio = {
  health: () => get<any>('/health'),
  analyzeTakes: (body: { takes: { take_id: string; path: string }[]; script?: string | null; language?: string | null; hints?: string | null }, onLog?: (l: string) => void) =>
    runTask<{ takes: any[]; selection: any }>('/studio/analyze-takes', body, onLog),
  plan: (body: { inputs: any; variant: string; aspect?: string; overrides?: any[]; use_llm?: boolean }) => post<{ plan: any; summary: any; notes: string[] }>('/studio/plan', body),
  render: (body: { plan: any; out_path: string; preview_times?: number[] }, onLog?: (l: string) => void) => runTask<any>('/studio/render', body, onLog),
  storyboard: (body: { plan: any; times: number[]; out_dir: string; width?: number }) => post<{ files: string[] }>('/studio/storyboard', body, 300_000),
  parseRequest: (text: string, context: any = {}) => post<{ ops: any[]; unhandled: string[] }>('/studio/parse-request', { text, context }),
  classifyReply: (text: string) => post<{ decision: 'approve' | 'reject' | 'changes' | 'unclear'; version: string | null; text: string; ops: any[]; unhandled: string[]; by: string }>('/studio/classify-reply', { text }),
  logo: (src: string, out_dir: string) => post<any>('/studio/brand/logo', { src, out_dir }),
  extractStyle: (path: string, name: string | null, onLog?: (l: string) => void, opts: { card?: boolean; model?: string } = {}) =>
    runTask<any>('/studio/extract-style', { path, name, card: opts.card ?? true, ...(opts.model ? { model: opts.model } : {}) }, onLog, 30),
  buildMachine: (body: { images: string[]; out_dir: string; name: string; cad?: string | null; method?: string; notes?: string; model?: string }, onLog?: (l: string) => void) =>
    runTask<any>('/studio/machine/build', body, onLog, 40),
  /** Claude directs the edit for several styles at once (research shared). Long: research, planning, storyboard checks. */
  direct: (body: { inputs: any; styles: any[]; settings?: any; library?: any[]; work_dir: string; previous?: any; request?: string | null; only?: string[]; overrides?: any[] },
    onLog?: (l: string) => void) => runTask<{ versions: any[]; research: any; assets: any[]; usage: any; transcript_words: number }>('/studio/direct', body, onLog, 90),
  icons: () => get<{ icons: string[] }>('/studio/icons'),
};
