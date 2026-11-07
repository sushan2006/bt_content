/**
 * Editing styles. A job renders one version per selected style; versions are labelled A, B, C... in that order.
 * Built-in styles live in the video service (services/analyzer/studio/styles.py); styles learned from a reference
 * video are rows in style_profiles and are referenced as "profile:<id>".
 */
import { one, q } from '../db/pool.js';

export const BUILTIN: Record<string, { name: string; about: string; group: 'style' | 'basic' }> = {
  editorial: { name: '3D Explainer', group: 'style', about: 'Cuts between you and full-screen 3D explainers; 3D objects rise from behind you; kinetic captions; light sound design.' },
  hype: { name: 'Bold & Fast', group: 'style', about: 'Jump cuts every ~2 s, punch-ins and zoom pulses on key words, big boxed captions, bold statement cards, louder beat.' },
  cinematic: { name: 'Cinematic Story', group: 'style', about: 'Letterbox, teal-orange film look with grain, slow push-ins, chapter cards that dip to black, subtle captions.' },
  minimal: { name: 'Clean & Minimal', group: 'style', about: 'Calm cuts on sentences only, soft-box captions, clean white number cards, a name card and almost no effects.' },
  clean: { name: 'Clean cut + captions', group: 'basic', about: 'Best takes joined, pauses removed, yellow-and-white captions. Nothing else.' },
  branded: { name: 'Branded', group: 'basic', about: 'Clean cut plus logo, name card and end card.' },
  motion: { name: 'Motion graphics (split screen)', group: 'basic', about: 'Graphics on top, you below.' },
  overlay: { name: 'Full video + floating graphics', group: 'basic', about: 'Full-frame video with floating graphics that avoid your face.' },
};
export const DEFAULT_STYLES = ['editorial', 'hype', 'cinematic', 'minimal'];
export const LETTERS = 'ABCDEFGHIJ';

const names = new Map<string, string>();

export async function styleName(key: string | null | undefined): Promise<string> {
  if (!key) return '';
  if (BUILTIN[key]) return BUILTIN[key].name;
  if (names.has(key)) return names.get(key)!;
  if (key.startsWith('profile:')) {
    const p = await one<any>('SELECT name FROM style_profiles WHERE id=$1', [key.slice(8)]).catch(() => null);
    const n = p ? `${p.name} (from reference)` : 'Style from reference';
    names.set(key, n);
    return n;
  }
  return key;
}

export function forgetStyleName(key: string) { names.delete(key); }

export function isValidStyle(key: string) {
  return !!BUILTIN[key] || /^profile:[0-9a-f-]{36}$/i.test(key);
}

export async function listStyles() {
  const profiles = await q<any>(`SELECT id, name, base, params, report, summary, source_name, status, error, card, created_at FROM style_profiles ORDER BY created_at DESC`);
  return [
    ...Object.entries(BUILTIN).map(([key, s]) => ({ key, name: s.name, about: s.about, group: s.group, source: 'built-in', status: 'ready' })),
    ...profiles.map((p) => ({ key: `profile:${p.id}`, id: p.id, name: p.name, about: p.summary ?? '', group: 'reference', source: p.source_name, status: p.status, error: p.error,
      base: p.base, base_name: BUILTIN[p.base === 'explainer3d' ? 'editorial' : p.base]?.name ?? p.base, report: p.report, params: p.params, card: p.card, created_at: p.created_at })),
  ];
}

/** What the video service needs to plan a version in this style. */
export async function styleRequest(key: string): Promise<{ variant: string; style_profile?: any }> {
  if (BUILTIN[key]) return { variant: key };
  const p = await one<any>(`SELECT * FROM style_profiles WHERE id=$1 AND status='ready'`, [key.slice(8)]);
  if (!p) throw new Error(`Style ${key} is not ready`);
  return { variant: 'profile', style_profile: { name: p.name, base: p.base, params: p.params, summary: p.summary, card: p.card ?? null } };
}

/** Styles the Claude director can plan (the basic layouts are always planned by the rules). */
export const DIRECTOR_STYLES = new Set(['editorial', 'hype', 'cinematic', 'minimal', 'profile']);
