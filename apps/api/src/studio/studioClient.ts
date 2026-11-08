/** Client for the Python video service: reference-style measurement and logo colours (no editing happens there). */
import { env } from '../config.js';
import { sleep } from '../lib/http.js';

async function post<T = any>(path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`${env.ANALYZER_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    throw new Error(`The video service is not reachable at ${env.ANALYZER_URL} (${(e as Error).message}). Start it with RUN_DEMO.bat.`);
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Video service error ${res.status}`);
  return data as T;
}

async function get<T = any>(path: string): Promise<T> {
  const res = await fetch(`${env.ANALYZER_URL}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Video service error ${res.status}`);
  return res.json() as Promise<T>;
}

interface Task<T = any> { id: string; status: 'running' | 'done' | 'failed'; log: string[]; result: T | null; error: string | null }

/** Starts a background task and waits for it. */
async function runTask<T>(path: string, body: unknown, maxMinutes = 30): Promise<T> {
  const { task_id } = await post<{ task_id: string }>(path, body);
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const t = await get<Task<T>>(`/studio/tasks/${task_id}`);
    if (t.status === 'done') return t.result as T;
    if (t.status === 'failed') throw new Error(t.error ?? 'task failed');
  }
  throw new Error('The video service took too long');
}

export const studio = {
  health: () => get<any>('/health'),
  logo: (src: string, out_dir: string) => post<any>('/studio/brand/logo', { src, out_dir }),
  /** Measures how a reference video is edited: cut rhythm, graphics share, colour, captions, sound. */
  extractStyle: (path: string, name: string) =>
    runTask<{ name: string; summary: string; report: string[]; measured: any }>('/studio/extract-style', { path, name }),
};
