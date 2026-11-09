/**
 * Style packs in the database (migration 014): added in the dashboard, used like the nine built-in styles.
 * The list is kept in memory (it is small) and reloaded at start, after every change and once a minute, so
 * isValidStyle() and the prompt builder can stay synchronous.
 */
import { one, q } from '../db/pool.js';
import type { Preset } from './presets.js';
import type { PackMeta, ParsedPack } from './packFormat.js';

export interface PackRow { id: string; key: string; name: string; meta: PackMeta; template: string; readme: string | null; created_at: string; updated_at: string }

let rows: PackRow[] = [];

export async function loadPacks(): Promise<void> {
  try {
    rows = await q<PackRow>(`SELECT id, key, name, meta, template, readme, created_at, updated_at FROM style_packs ORDER BY created_at, key`);
  } catch (e) {
    console.warn('[studio] style packs not loaded:', (e as Error).message);   // e.g. before migration 014 has run
  }
}

export const packRows = () => rows;
export const isPackKey = (key: string | null | undefined) => !!key && rows.some((r) => r.key === key);
export const packTemplate = (key: string) => rows.find((r) => r.key === key)?.template ?? null;

/** A pack as a Preset, so the prompt builder treats it like a built-in style. Its template carries the whole style. */
export function packPreset(key: string | null | undefined): Preset | null {
  const i = rows.findIndex((r) => r.key === key);
  if (i < 0) return null;
  const r = rows[i];
  return { key: r.key, number: 10 + i, name: r.name, tagline: r.meta.tagline, technique: r.meta.technique, about: r.meta.about, looks: r.meta.looks, best_for: r.meta.best_for,
    good_to_know: r.meta.good_to_know, storyboard_first: !!r.meta.storyboard_first, footage_only: !!r.meta.footage_only, defaults: r.meta.defaults,
    example_topic: r.meta.example_topic, spec: [] };
}
export const packPresets = (): Preset[] => rows.map((r) => packPreset(r.key)!);

/** Adds a pack, or replaces the pack with the same key. */
export async function savePack(p: ParsedPack, userId: string | null): Promise<{ id: string; created: boolean }> {
  const existing = await one<{ id: string }>('SELECT id FROM style_packs WHERE key=$1', [p.key]);
  const row = await one<{ id: string }>(
    `INSERT INTO style_packs (key, name, meta, template, readme, thumb, thumb_type, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, meta=EXCLUDED.meta, template=EXCLUDED.template, readme=EXCLUDED.readme,
       thumb=EXCLUDED.thumb, thumb_type=EXCLUDED.thumb_type, updated_at=now() RETURNING id`,
    [p.key, p.name, JSON.stringify(p.meta), p.template, p.readme, p.thumb, p.thumbType, userId]);
  await loadPacks();
  return { id: row!.id, created: !existing };
}

export async function deletePack(id: string): Promise<void> {
  await q('DELETE FROM style_packs WHERE id=$1', [id]);
  await loadPacks();
}

export const packThumb = (id: string) => one<{ thumb: Buffer; thumb_type: string }>('SELECT thumb, thumb_type FROM style_packs WHERE id=$1', [id]);
