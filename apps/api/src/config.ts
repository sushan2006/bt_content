import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// .env lives at the repository root
loadEnv({ path: path.resolve(here, '../../../.env') });

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/content_bt'),
  REDIS_URL: z.string().optional().default(''),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  MEDIA_STORAGE_DIR: z.string().default('../../storage/media'),
  ANALYZER_URL: z.string().default('http://localhost:8001'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_GRAPH_VERSION: z.string().default('v25.0'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const mediaDir = path.resolve(here, '..', env.MEDIA_STORAGE_DIR);
export const isProd = env.NODE_ENV === 'production';
