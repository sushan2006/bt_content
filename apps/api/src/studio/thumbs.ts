/**
 * Thumbnails with FFmpeg: a frame from a video, and any image turned into a JPEG the platforms accept
 * (Instagram covers must be JPEG under 8 MB, YouTube thumbnails under 2 MB).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
function ffmpegBin(): string {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  try { return (require('ffmpeg-static') as string) || 'ffmpeg'; } catch { return 'ffmpeg'; }
}

function run(args: string[], timeoutMs = 120_000): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegBin(), ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 1, err: e.message }); });
  });
}

/** Length of a video in seconds (from FFmpeg's header read), or null. */
export async function videoDuration(src: string): Promise<number | null> {
  const r = await run(['-i', src], 30_000);
  const m = r.err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * A JPEG frame of a video. With `at`, exactly that moment; without it, the most representative frame of a short
 * window about a fifth into the video (FFmpeg's thumbnail filter skips blurry and black frames).
 */
export async function videoFrame(src: string, dest: string, at?: number | null): Promise<{ time: number }> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const dur = (await videoDuration(src)) ?? 0;
  const exact = at != null && Number.isFinite(at);
  const t = exact ? Math.max(0, Math.min(Number(at), Math.max(0, dur - 0.05))) : Math.min(Math.max(dur * 0.2, 0.3), Math.max(0, dur - 1.5), 6);
  const vf = `${exact ? '' : 'thumbnail=36,'}scale='min(1080,iw)':-2`;
  const r = await run(['-ss', t.toFixed(3), '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '3', dest]);
  if (r.code !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error(`Could not take a frame from the video: ${r.err.split('\n').slice(-3).join(' ').slice(0, 300)}`);
  return { time: Math.round(t * 100) / 100 };
}

/** Any image (JPEG, PNG, WebP) -> a JPEG of at most 1920 px on its long side and under 2 MB. */
export async function toJpeg(src: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.jpg`;
  for (const q of [2, 4, 7, 10]) {
    const r = await run(['-i', src, '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',format=yuvj420p", '-frames:v', '1', '-q:v', String(q), tmp]);
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`That image could not be read: ${r.err.split('\n').slice(-2).join(' ').slice(0, 200)}`);
    if (fs.statSync(tmp).size < 2_000_000 || q === 10) break;
  }
  fs.renameSync(tmp, dest);
}
