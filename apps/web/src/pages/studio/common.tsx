import { Badge } from '../../components/ui';

/** Where a video is. Every status belongs to one of the four stages shown on the Studio dashboard. */
export const STATUS: Record<string, { label: string; color: any; hint: string }> = {
  prompt_ready: { label: 'Prompt ready', color: 'violet', hint: 'Set up; copy the prompt into Claude Code' },
  with_claude: { label: 'Editing with Claude', color: 'blue', hint: 'Prompt copied; the edit happens in Claude Code' },
  completed: { label: 'Ready to publish', color: 'green', hint: 'The finished video is in content_final' },
  publishing: { label: 'Publishing', color: 'green', hint: 'Uploading to the platforms' },
  published: { label: 'Published', color: 'green', hint: 'Posted' },
  cancelled: { label: 'Cancelled', color: 'gray', hint: '' },
};

/** A video still being made (its prompt can be copied, suggestions added). */
export const OPEN = ['prompt_ready', 'with_claude'];

export const KIND: Record<string, { label: string; about: string }> = {
  footage: { label: 'Camera footage', about: 'I recorded takes; Claude picks the best take of every line and adds the motion graphics' },
  voiceover: { label: 'Voiceover MP3', about: 'Claude animates everything in the style, timed to my voice' },
  animation: { label: 'Nothing yet', about: 'Claude writes the script and animates the whole video from the topic' },
};

/** Where a video's thumbnail came from. */
export const THUMB_SOURCE: Record<string, string> = { claude: 'Made by Claude', upload: 'Uploaded picture', frame: 'Frame picked from the video', auto: 'Picked automatically from the video' };

export const PLATFORMS = [{ k: 'instagram', l: 'Instagram Reel' }, { k: 'facebook', l: 'Facebook Reel' }, { k: 'youtube', l: 'YouTube' }];

export function StatusBadge({ s }: { s: string }) {
  const x = STATUS[s] ?? { label: s, color: 'gray' };
  return <Badge color={x.color}>{x.label}</Badge>;
}

export const fmtLength = (sec?: number | null) => (!sec ? 'Any length' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
export const fmtMB = (b?: number | null) => (b ? `${(Number(b) / 1e6).toFixed(1)} MB` : '');

/** Upload with progress (fetch has no upload progress). */
export function uploadFiles(url: string, files: File[], extra: Record<string, string> = {}, onProgress?: (p: number) => void, field = 'file'): Promise<any> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    files.forEach((f) => fd.append(field, f));
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.withCredentials = true;
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => { try { const d = JSON.parse(x.responseText || '{}'); x.status < 300 ? resolve(d) : reject(new Error(d.error ?? x.statusText)); } catch { reject(new Error(x.statusText)); } };
    x.onerror = () => reject(new Error('Upload failed'));
    x.send(fd);
  });
}

export const listInput = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** Copies text, also on plain-http pages where navigator.clipboard is not available. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('Could not copy: select the prompt text and copy it by hand');
}
