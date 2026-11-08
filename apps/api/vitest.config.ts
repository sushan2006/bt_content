import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/content_bt_test', REDIS_URL: '' }, fileParallelism: false, testTimeout: 30000 } });
