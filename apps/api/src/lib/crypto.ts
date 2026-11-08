import crypto from 'node:crypto';
import { env } from '../config.js';

const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1') throw new Error('Unknown token encryption version');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
