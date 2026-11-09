import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACK_KEY, PACK_LIMITS, packKey, parsePack, sniffImage } from '../src/studio/packFormat.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const meta = { name: 'Neon Grid', tagline: 'night city', technique: 'Canvas 2D', about: 'Glowing grid lines.', looks: 'Dark with neon lines.', best_for: 'Tech explainers.', example_topic: 'How Wi-Fi works' };
const tpl = `# TASK\n${'Build the video in this style. '.repeat(12)}\n**Topic:** {{TOPIC}}\n{{SETTINGS}}\n{{AUDIO_SETTINGS}}\n`;
const file = (name: string, data: Buffer | string) => ({ name, data: Buffer.from(data) });
const good = () => [file('style.json', JSON.stringify(meta)), file('template.md', tpl), file('thumbnail.png', PNG)];

describe('style packs', () => {
  it('accepts a complete pack and makes its key from the name', () => {
    const r = parsePack(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.key).toBe('pack_neon_grid');
    expect(r.pack.name).toBe('Neon Grid');
    expect(r.pack.thumbType).toBe('image/png');
    expect(r.pack.meta.storyboard_first).toBe(false);
    expect(r.pack.meta.footage_only).toBe(false);
    expect(r.pack.readme).toBeNull();
    expect(PACK_KEY.test(r.pack.key)).toBe(true);
  });

  it('reads files picked from a folder (paths, upper case, Windows line endings, a byte-order mark)', () => {
    const r = parsePack([
      file('C:\\packs\\neon\\Style.JSON', '\uFEFF' + JSON.stringify(meta)),
      file('neon/Template.md', tpl.replace(/\n/g, '\r\n')),
      file('neon/THUMBNAIL.JPG', JPG),
      file('neon/README.md', 'Notes\r\nfor people'),
      file('neon/.DS_Store', 'x'),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.template.includes('\r')).toBe(false);
    expect(r.pack.thumbType).toBe('image/jpeg');
    expect(r.pack.readme).toBe('Notes\nfor people');
    expect(r.pack.ignored).toEqual(['.DS_Store']);
  });

  it('reports every missing file at once', () => {
    const r = parsePack([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toMatch(/style\.json is missing/);
    expect(r.errors.join(' ')).toMatch(/template\.md is missing/);
    expect(r.errors.join(' ')).toMatch(/thumbnail\.png is missing/);
  });

  it('names the missing fields in style.json and the missing placeholders in the template', () => {
    const r = parsePack([file('style.json', JSON.stringify({ name: 'A' })), file('template.md', `${'x'.repeat(400)} {{TOPIC}}`), file('thumbnail.png', PNG)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join('\n');
    expect(all).toContain('"tagline"');
    expect(all).toContain('"example_topic"');
    expect(all).toContain('{{SETTINGS}}');
    expect(all).toContain('{{AUDIO_SETTINGS}}');
    expect(all).not.toContain('{{TOPIC}},');
  });

  it('rejects broken JSON, a too-short template, a fake picture and a too-large picture', () => {
    expect(parsePack([file('style.json', '{ nope'), file('template.md', tpl), file('thumbnail.png', PNG)])).toMatchObject({ ok: false });
    const short = parsePack([file('style.json', JSON.stringify(meta)), file('template.md', '{{TOPIC}} {{SETTINGS}} {{AUDIO_SETTINGS}}'), file('thumbnail.png', PNG)]);
    expect(short.ok).toBe(false);
    const fake = parsePack([file('style.json', JSON.stringify(meta)), file('template.md', tpl), file('thumbnail.png', 'this is text, not a picture')]);
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(fake.errors.join(' ')).toMatch(/not a real png/);
    const big = parsePack([file('style.json', JSON.stringify(meta)), file('template.md', tpl), file('thumbnail.png', Buffer.concat([PNG, Buffer.alloc(PACK_LIMITS.thumbnail)]))]);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors.join(' ')).toMatch(/larger than 2 MB/);
  });

  it('always gives a reason, even when style.json holds only null, a list or a number', () => {
    for (const body of ['null', '[]', '7', '"text"']) {
      const r = parsePack([file('style.json', body), file('template.md', tpl), file('thumbnail.png', PNG)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.length > 0).toBe(true);
    }
  });

  it('keeps optional options, and ignores unknown fields', () => {
    const r = parsePack([file('style.json', JSON.stringify({ ...meta, footage_only: true, storyboard_first: true, defaults: { music: false, sfx: false }, extra: 1 })), file('template.md', tpl), file('thumbnail.png', PNG)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.meta.footage_only).toBe(true);
    expect(r.pack.meta.storyboard_first).toBe(true);
    expect(r.pack.meta.defaults).toEqual({ music: false, sfx: false });
    expect((r.pack.meta as any).extra).toBeUndefined();
  });

  it('makes safe keys', () => {
    expect(packKey('Neon Grid!')).toBe('pack_neon_grid');
    expect(packKey('  Hello, World -- 2! ')).toBe('pack_hello_world_2');
    expect(packKey('pack_Already')).toBe('pack_already');
    expect(PACK_KEY.test(packKey('../../etc/passwd'))).toBe(true);
    expect(PACK_KEY.test(packKey('!'))).toBe(false);
    const r = parsePack([file('style.json', JSON.stringify({ ...meta, name: '!!' })), file('template.md', tpl), file('thumbnail.png', PNG)]);
    expect(r.ok).toBe(false);
    const own = parsePack([file('style.json', JSON.stringify({ ...meta, key: 'My Own Id' })), file('template.md', tpl), file('thumbnail.png', PNG)]);
    expect(own.ok && own.pack.key).toBe('pack_my_own_id');
  });

  it('knows picture types from their first bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPG)).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

// docs/STYLE_PACK_KIT.md is handed to a Claude chat on another account, so it must stay self-contained and correct:
// the example pack and the checker script inside it must be the real files, and the example must pass the dashboard's check.
describe('the Style Pack Kit (docs/STYLE_PACK_KIT.md)', () => {
  const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
  const kit = fs.readFileSync(path.join(docs, 'STYLE_PACK_KIT.md'), 'utf8').replace(/\r\n/g, '\n');
  const embedded: Record<string, string> = Object.fromEntries([...kit.matchAll(/<!-- BEGIN (\S+) -->\n`{4}[a-z]*\n([\s\S]*?)\n`{4}\n<!-- END \1 -->/g)].map((m) => [m[1], m[2]]));
  const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');

  it('embeds the example pack exactly as it is in docs/style-pack-example', () => {
    for (const f of ['style.json', 'template.md', 'README.md']) expect(embedded[`example/${f}`]).toBe(read(path.join(docs, 'style-pack-example', f)));
  });
  it('embeds the pack checker exactly as it is in scripts/check_style_pack.py', () => {
    expect(embedded['check_style_pack.py']).toBe(read(path.join(docs, '..', 'scripts', 'check_style_pack.py')));
  });
  it('the example inside the kit is a pack the dashboard accepts', () => {
    const r = parsePack([
      file('style.json', embedded['example/style.json']), file('template.md', embedded['example/template.md']), file('README.md', embedded['example/README.md']),
      file('thumbnail.png', fs.readFileSync(path.join(docs, 'style-pack-example', 'thumbnail.png'))),
    ]);
    expect(r.ok).toBe(true);
  });
  it('states the text limits the dashboard enforces', () => {
    expect(kit).toContain('`name` 40, `tagline` 40, `technique` 80, `about` 160, `looks` 700, `best_for` 400, `example_topic` 160, `good_to_know` 500 characters');
    const long = (f: string, n: number) => parsePack([file('style.json', JSON.stringify({ ...meta, [f]: 'x'.repeat(n) })), file('template.md', tpl), file('thumbnail.png', PNG)]).ok;
    for (const [f, n] of [['name', 40], ['tagline', 40], ['technique', 80], ['about', 160], ['looks', 700], ['best_for', 400], ['example_topic', 160], ['good_to_know', 500]] as [string, number][]) {
      expect(long(f, n)).toBe(true);
      expect(long(f, n + 1)).toBe(false);
    }
  });
});
