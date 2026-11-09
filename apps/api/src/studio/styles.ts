/**
 * Editing styles: the nine built-in presets (presets.ts), style packs added in the dashboard (style_packs, "pack_<name>",
 * see packs.ts) and styles learned from a reference video (style_profiles, "profile:<id>"). A video is made in one style;
 * its spec goes into the prompt for Claude Code.
 */
import { one, q } from '../db/pool.js';
import { LEGACY_STYLES, PRESET_BY_KEY, PRESETS, type Preset } from './presets.js';
import { isPackKey, packPreset, packRows } from './packs.js';

const names = new Map<string, string>();

export async function styleName(key: string | null | undefined): Promise<string> {
  if (!key) return '';
  if (PRESET_BY_KEY[key]) return PRESET_BY_KEY[key].name;
  if (LEGACY_STYLES[key]) return LEGACY_STYLES[key];
  if (key.startsWith('pack_')) return packPreset(key)?.name ?? 'Removed style';
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

/** A style a new video can use: a preset or a reference style. */
export function isValidStyle(key: string) {
  return !!PRESET_BY_KEY[key] || isPackKey(key) || /^profile:[0-9a-f-]{36}$/i.test(key);
}

/** The Preset behind a style key: a built-in style or a style pack. */
export const presetFor = (key: string): Preset | null => PRESET_BY_KEY[key] ?? packPreset(key);

export async function listStyles() {
  const profiles = await q<any>(`SELECT id, name, report, summary, notes, source_name, status, error, drive_link, created_at FROM style_profiles ORDER BY created_at DESC`);
  return [
    ...PRESETS.map((p) => ({ key: p.key, group: 'preset', status: 'ready', number: p.number, name: p.name, tagline: p.tagline, technique: p.technique, about: p.about,
      looks: p.looks, best_for: p.best_for, good_to_know: p.good_to_know ?? null, storyboard_first: p.storyboard_first, example_topic: p.example_topic,
      footage_only: !!p.footage_only, defaults: p.defaults ?? null })),
    ...packRows().map((r) => { const p = packPreset(r.key)!; return { key: r.key, group: 'preset', custom: true, pack_id: r.id, status: 'ready', number: p.number, name: p.name, tagline: p.tagline,
      technique: p.technique, about: p.about, looks: p.looks, best_for: p.best_for, good_to_know: p.good_to_know ?? null, storyboard_first: p.storyboard_first,
      example_topic: p.example_topic, footage_only: !!p.footage_only, defaults: p.defaults ?? null, readme: r.readme,
      thumbnail: `/api/studio/style-packs/${r.id}/thumbnail?v=${new Date(r.updated_at).getTime()}` }; }),
    ...profiles.map((p) => ({ key: `profile:${p.id}`, id: p.id, group: 'reference', name: p.name, about: p.summary ?? '', notes: p.notes ?? '', source: p.source_name,
      status: p.status, error: p.error, report: p.report ?? [], drive_link: p.drive_link, created_at: p.created_at })),
  ];
}
