import type { PlatformAdapter } from './types.js';
import { instagramAdapter } from './instagram.js';
import { facebookAdapter } from './facebook.js';
import { youtubeAdapter } from './youtube.js';

/**
 * Adding a platform (e.g. LinkedIn):
 *  1. INSERT a row into `platforms` and its metric_definitions
 *  2. implement PlatformAdapter in ./linkedin.ts
 *  3. register it here + add its OAuth routes
 * No schema change is required.
 */
export const adapters: Record<string, PlatformAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  youtube: youtubeAdapter,
};
