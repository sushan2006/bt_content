import type { SyncWriter } from '../sync/writer.js';

export interface SocialAccountRow {
  id: string;
  platform_code: string;
  external_account_id: string;
  display_name: string;
  data_origin: 'live' | 'demo';
  metadata: any;
  last_synced_at: string | null;
}

export interface SyncContext {
  account: SocialAccountRow;
  writer: SyncWriter;
  jobId: string;
  backfillDays: number;
  maxMedia: number;
  log: (level: 'info' | 'warn' | 'error', message: string, extra?: { endpoint?: string; http_status?: number; details?: unknown }) => Promise<void>;
  /** Count of non-fatal errors (e.g. one metric unsupported). */
  softErrors: number;
}

export interface PlatformAdapter {
  platform: string;
  sync(ctx: SyncContext): Promise<void>;
}
