/** The full prompt template of each preset style (apps/api/templates/studio/<key>.md), read once and cached. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/studio');
const cache = new Map<string, string | null>();

export function styleTemplate(key: string | null | undefined): string | null {
  if (!key || !/^[a-z_]+$/.test(key)) return null;
  if (cache.has(key)) return cache.get(key)!;
  const file = path.join(TEMPLATE_DIR, `${key}.md`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  cache.set(key, text);
  return text;
}
