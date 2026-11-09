/**
 * Style packs: the pure part (reading and checking the files of a pack). No database here, so it is unit tested.
 *
 * A pack is a handful of files picked together in the dashboard:
 *   style.json      the card text and options (name, tagline, technique, about, looks, best_for, example_topic, ...)
 *   template.md     the full prompt template; section 1 holds {{TOPIC}}, {{SETTINGS}} and {{AUDIO_SETTINGS}}
 *   thumbnail.png   the picture on the style card (png, jpg, webp or gif, under 2 MB)
 *   README.md       optional notes shown on the style's detail page
 */
import { z } from 'zod';

export const PACK_LIMITS = { json: 20_000, template: 150_000, readme: 60_000, thumbnail: 2 * 1024 * 1024, each: 2.5 * 1024 * 1024 };
export const PLACEHOLDERS = ['{{TOPIC}}', '{{SETTINGS}}', '{{AUDIO_SETTINGS}}'] as const;
export const MIN_TEMPLATE_CHARS = 300;

const text = (max: number) => z.string().trim().min(1).max(max);
export const packMetaSchema = z.object({
  name: text(40),
  key: z.string().trim().optional(),                    // optional short id; otherwise made from the name
  tagline: text(40),                                    // two or three words under the name
  technique: text(80),                                  // how Claude builds it
  about: text(160),                                     // one line on the card
  looks: text(700),                                     // "What it looks like"
  best_for: text(400),                                  // "Best for"
  good_to_know: z.string().trim().max(500).optional(),  // red box on the detail page; also goes to Claude
  example_topic: text(160),
  storyboard_first: z.boolean().default(false),
  footage_only: z.boolean().default(false),             // edits real footage only (like Simple Edit)
  defaults: z.object({ music: z.boolean().optional(), sfx: z.boolean().optional(), subtitles: z.boolean().optional() }).optional(),
});

export interface PackMeta {
  tagline: string; technique: string; about: string; looks: string; best_for: string; good_to_know?: string; example_topic: string;
  storyboard_first: boolean; footage_only: boolean; defaults?: { music?: boolean; sfx?: boolean; subtitles?: boolean };
}
export interface ParsedPack { key: string; name: string; meta: PackMeta; template: string; readme: string | null; thumb: Buffer; thumbType: string; ignored: string[] }
export type PackResult = { ok: true; pack: ParsedPack } | { ok: false; errors: string[] };

/** "Neon Grid!" -> pack_neon_grid */
export function packKey(s: string): string {
  const slug = s.toLowerCase().replace(/^pack_/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30).replace(/_+$/, '');
  return `pack_${slug}`;
}
export const PACK_KEY = /^pack_[a-z0-9_]{2,30}$/;

/** The picture type from the first bytes (not from the file name). */
export function sniffImage(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const baseName = (n: string) => (n.split(/[\\/]/).pop() ?? '').trim();

/** Reads the files picked in the dashboard. Every problem is reported at once, in plain words. */
export function parsePack(input: { name: string; data: Buffer }[]): PackResult {
  const errors: string[] = [];
  const byName = new Map<string, Buffer>();
  const originals = new Map<string, string>();
  for (const f of input) { const n = baseName(f.name); if (n) { byName.set(n.toLowerCase(), f.data); originals.set(n.toLowerCase(), n); } }
  const thumbName = [...byName.keys()].find((n) => /^thumbnail\.(png|jpe?g|webp|gif)$/.test(n));
  const used = new Set<string>(['style.json', 'template.md', 'readme.md']);
  if (thumbName) used.add(thumbName);
  const ignored = [...byName.keys()].filter((n) => !used.has(n)).map((n) => originals.get(n)!);

  // style.json
  let meta: z.infer<typeof packMetaSchema> | null = null;
  const jsonBuf = byName.get('style.json');
  if (!jsonBuf) errors.push('style.json is missing (the style name, tagline, what it looks like, and so on).');
  else if (jsonBuf.length > PACK_LIMITS.json) errors.push('style.json is too large.');
  else {
    let raw: unknown = null; let parsed = false;
    try { raw = JSON.parse(jsonBuf.toString('utf8').replace(/^\uFEFF/, '')); parsed = true; } catch (e) { errors.push(`style.json is not valid JSON (${(e as Error).message}).`); }
    if (parsed) {
      const r = packMetaSchema.safeParse(raw);
      if (!r.success) for (const i of r.error.issues) errors.push(`style.json: "${i.path.join('.') || 'file'}" ${i.code === 'invalid_type' ? 'is missing or not the right type' : i.message}.`);
      else meta = r.data;
    }
  }

  // template.md
  let template = '';
  const tBuf = byName.get('template.md');
  if (!tBuf) errors.push('template.md is missing (the full prompt template for this style).');
  else if (tBuf.length > PACK_LIMITS.template) errors.push('template.md is too large (limit 150 KB).');
  else {
    template = tBuf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    if (template.length < MIN_TEMPLATE_CHARS) errors.push('template.md is too short to be a full style template.');
    const missing = PLACEHOLDERS.filter((p) => !template.includes(p));
    if (missing.length) errors.push(`template.md must contain ${missing.join(', ')} (the dashboard fills in these placeholders for each video).`);
  }

  // thumbnail
  let thumb: Buffer | null = null; let thumbType = '';
  if (!thumbName) errors.push('thumbnail.png is missing (a picture of the style: png, jpg, webp or gif, named "thumbnail").');
  else {
    const b = byName.get(thumbName)!;
    const t = sniffImage(b);
    if (!t) errors.push(`${originals.get(thumbName)} is not a real png, jpg, webp or gif picture.`);
    else if (b.length > PACK_LIMITS.thumbnail) errors.push(`${originals.get(thumbName)} is larger than 2 MB.`);
    else { thumb = b; thumbType = t; }
  }

  // README (optional)
  let readme: string | null = null;
  const rBuf = byName.get('readme.md');
  if (rBuf) { if (rBuf.length > PACK_LIMITS.readme) errors.push('README.md is too large.'); else readme = rBuf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() || null; }

  // key
  let key = '';
  if (meta) {
    key = meta.key ? packKey(meta.key) : packKey(meta.name);
    if (!PACK_KEY.test(key)) errors.push('The style needs a name with at least two letters or numbers.');
  }

  if (errors.length || !meta || !thumb) return { ok: false, errors };
  const { name, key: _k, ...rest } = meta;
  return { ok: true, pack: { key, name, meta: rest, template, readme, thumb, thumbType, ignored } };
}
