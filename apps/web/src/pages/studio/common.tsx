import { ReactNode } from 'react';
import { Badge } from '../../components/ui';

export const STATUS: Record<string, { label: string; color: any; stage: number }> = {
  new: { label: 'Waiting for footage', color: 'gray', stage: 0 },
  waiting_suggestions: { label: 'Collecting suggestions', color: 'violet', stage: 1 },
  analyzing: { label: 'Choosing the best takes', color: 'blue', stage: 2 },
  planning: { label: 'Planning the edit', color: 'blue', stage: 2 },
  rendering: { label: 'Rendering versions', color: 'blue', stage: 2 },
  in_review: { label: 'Waiting for approval', color: 'amber', stage: 3 },
  changes_requested: { label: 'Making changes', color: 'blue', stage: 2 },
  approved: { label: 'Approved', color: 'green', stage: 4 },
  publishing: { label: 'Publishing', color: 'green', stage: 4 },
  published: { label: 'Published', color: 'green', stage: 6 },
  rejected: { label: 'Not approved', color: 'red', stage: 3 },
  failed: { label: 'Needs attention', color: 'red', stage: -1 },
  cancelled: { label: 'Cancelled', color: 'gray', stage: -1 },
};
export const STAGES = ['Footage', 'Suggestions', 'Editing', 'Approval', 'Publishing', 'Live'];
export const VARIANT_NAME: Record<string, string> = {
  editorial: '3D Explainer', hype: 'Bold & Fast', cinematic: 'Cinematic Story', minimal: 'Clean & Minimal',
  clean: 'Clean cut + captions', branded: 'Branded', motion: 'Motion graphics (split screen)', overlay: 'Full video + floating graphics',
};
export const styleLabel = (k?: string | null, name?: string | null) => name || (k ? VARIANT_NAME[k] ?? (k.startsWith('profile:') ? 'Style from reference' : k) : '');

/** Pick the editing styles to render (one version per style, labelled A, B, C… in this order). */
export function StylePicker({ styles, value, onChange }: { styles: any[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups: [string, string][] = [['style', 'Editing styles'], ['reference', 'Learned from your reference videos'], ['basic', 'Basic versions']];
  const toggle = (k: string, on: boolean) => onChange(on ? [...value, k] : value.filter((x) => x !== k));
  return (
    <div className="space-y-3">
      {groups.map(([g, title]) => {
        const items = styles.filter((s) => s.group === g && s.status === 'ready');
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="text-xs font-medium text-ink-2 mb-1">{title}</div>
            {items.map((s) => {
              const i = value.indexOf(s.key);
              return (
                <label key={s.key} className={`flex items-start gap-2 text-sm py-1.5 px-2 rounded-lg border mb-1 cursor-pointer ${i >= 0 ? 'border-ink bg-stone-50' : 'border-stone-200'}`}>
                  <input type="checkbox" className="mt-1" checked={i >= 0} onChange={(e) => toggle(s.key, e.target.checked)} />
                  <span className="min-w-0"><b>{i >= 0 ? `${'ABCDEFGH'[i]} · ` : ''}{s.name}</b>{s.base_name ? <span className="text-ink-3"> (based on {s.base_name})</span> : null}
                    <span className="block text-[11px] text-ink-3 leading-snug">{s.about}</span></span>
                </label>);
            })}
          </div>);
      })}
    </div>);
}

export function StatusBadge({ s }: { s: string }) {
  const x = STATUS[s] ?? { label: s, color: 'gray' };
  return <Badge color={x.color}>{x.label}</Badge>;
}

export function Stepper({ status }: { status: string }) {
  const cur = STATUS[status]?.stage ?? 0;
  const bad = status === 'failed' || status === 'rejected' || status === 'cancelled';
  return (
    <ol className="flex items-center gap-0 w-full">
      {STAGES.map((s, i) => {
        const done = !bad && i < cur, active = i === cur || (status === 'published' && i === 5);
        return (
          <li key={s} className="flex-1 flex items-center min-w-0">
            <div className="flex flex-col items-center min-w-0">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${done ? 'bg-emerald-600 border-emerald-600 text-white' : active ? (bad ? 'border-red-500 text-red-600 bg-red-50' : 'border-ink text-ink bg-white') : 'border-stone-300 text-ink-3 bg-white'}`}>{done ? '✓' : i + 1}</span>
              <span className={`text-[11px] mt-1 truncate ${active ? 'text-ink font-medium' : 'text-ink-3'}`}>{s}</span>
            </div>
            {i < STAGES.length - 1 && <span className={`flex-1 h-0.5 mx-1 -mt-4 ${done ? 'bg-emerald-600' : 'bg-stone-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function Pill({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${ok === null ? 'bg-stone-50 border-stone-200 text-ink-2' : ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>{ok === null ? '•' : ok ? '✓' : '!'} {children}</span>;
}

/** Upload with progress (fetch has no upload progress). */
export function uploadFiles(url: string, files: File[], extra: Record<string, string> = {}, onProgress?: (p: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    files.forEach((f) => fd.append('file', f));
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
