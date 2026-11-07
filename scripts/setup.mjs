// Creates .env from .env.example with fresh random secrets (run once):  node scripts/setup.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('..', import.meta.url);
const envPath = new URL('.env', root);
if (fs.existsSync(envPath)) { console.log('.env already exists — leaving it unchanged.'); process.exit(0); }
let s = fs.readFileSync(new URL('.env.example', root), 'utf8');
s = s.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`)
     .replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
fs.writeFileSync(envPath, s);
console.log('Created .env with random JWT_SECRET and TOKEN_ENCRYPTION_KEY.');
console.log('IMPORTANT: back up TOKEN_ENCRYPTION_KEY — stored OAuth tokens cannot be decrypted without it.');
