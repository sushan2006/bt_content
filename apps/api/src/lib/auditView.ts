/** Plain-language view of audit_logs rows: areas (the tabs), readable action names, short detail text, CSV. Pure functions. */

/** First matching rule wins. `like` are SQL LIKE patterns on audit_logs.action. */
export const AREAS: { key: string; label: string; like: string[] }[] = [
  { key: 'publishing', label: 'Publishing', like: ['studio.publish%', 'publication.%'] },
  { key: 'studio', label: 'Studio', like: ['studio.%'] },
  { key: 'accounts', label: 'Accounts & sync', like: ['account.%', 'workspace.%', 'sync.%'] },
  { key: 'analysis', label: 'Analysis', like: ['analysis.%', 'intelligence.%', 'recommendation.%', 'feature.%'] },
  { key: 'content', label: 'Content', like: ['content.%', 'asset.%', 'category.%', 'data.%'] },
  { key: 'users', label: 'Users & sign-in', like: ['auth.%', 'user.%'] },
  { key: 'settings', label: 'Settings', like: ['settings.%'] },
];
export const AREA_OTHER = { key: 'other', label: 'Other' };

const likeToRegex = (p: string) => new RegExp('^' + p.replace(/[.]/g, '\\.').replace(/%/g, '.*') + '$');
export function areaOf(action: string): { key: string; label: string } {
  for (const a of AREAS) if (a.like.some((p) => likeToRegex(p).test(action))) return a;
  return AREA_OTHER;
}
/** SQL expression giving the area key of a.action (constants only, safe to inline). */
export const AREA_SQL = `CASE ${AREAS.map((a) => `WHEN a.action LIKE ANY (ARRAY[${a.like.map((p) => `'${p}'`).join(',')}]) THEN '${a.key}'`).join(' ')} ELSE '${AREA_OTHER.key}' END`;
/** SQL condition for "a.action is in this area". */
export function areaWhere(key: string): string | null {
  const a = AREAS.find((x) => x.key === key);
  if (a) {
    const earlier = AREAS.slice(0, AREAS.indexOf(a)).flatMap((x) => x.like);
    return `(a.action LIKE ANY (ARRAY[${a.like.map((p) => `'${p}'`).join(',')}])${earlier.length ? ` AND NOT a.action LIKE ANY (ARRAY[${earlier.map((p) => `'${p}'`).join(',')}])` : ''})`;
  }
  if (key === AREA_OTHER.key) return `${AREA_SQL} = 'other'`;
  return null;
}

/** An action counts as failed when its name says so. */
export const FAILED_SQL = `(a.action ~ '(failed|error|denied|rejected)')`;
export const isFailed = (action: string) => /(failed|error|denied|rejected)/.test(action);

export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Sign-in failed',
  'user.create': 'Created a user', 'user.update': 'Updated a user', 'user.password_change': 'Changed a password',
  'settings.update': 'Changed a setting', 'settings.segments': 'Changed the video segments',
  'account.connect': 'Connected an account', 'account.disconnect': 'Disconnected an account',
  'workspace.connect': 'Connected Google Drive', 'workspace.disconnect': 'Disconnected Google Drive',
  'sync.manual': 'Started a sync',
  'analysis.run': 'Ran the analysis', 'intelligence.run': 'Ran the analysis',
  'recommendation.review': 'Reviewed a recommendation', 'feature.correct': 'Corrected a video detail',
  'data.export': 'Exported data', 'category.create': 'Created a category', 'content.create': 'Added a content item', 'asset.upload': 'Uploaded a file',
  'publication.link': 'Linked a post to a video',
  'studio.job.create': 'Set up a video', 'studio.job.cancel': 'Cancelled a video', 'studio.job.reopen': 'Reopened a video',
  'studio.prompt.copy': 'Copied a video prompt', 'studio.final.scan': 'Checked Drive for finished videos', 'studio.final.upload': 'Uploaded a finished video',
  'studio.publish': 'Published a video', 'studio.thumbnail.upload': 'Set a thumbnail', 'studio.machine.add': 'Added a machine',
  'studio.music.add': 'Added a music track', 'studio.settings': 'Changed studio settings', 'studio.style.add': 'Added a style',
  'studio.style_pack.add': 'Added a style pack', 'studio.style_pack.replace': 'Replaced a style pack', 'studio.style_pack.delete': 'Deleted a style pack',
};
const humanize = (s: string) => { const t = s.replace(/[._]/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
export const actionLabel = (action: string) => ACTION_LABELS[action] ?? humanize(action);

const ENTITY_LABELS: Record<string, string> = {
  user: 'User', production_job: 'Video', content_item: 'Content item', social_account: 'Account', publication: 'Post', setting: 'Setting',
  segment_template: 'Segments', music_track: 'Music track', style_pack: 'Style pack', style_profile: 'Style', machine: 'Machine', category: 'Category',
  workspace: 'Google Drive', studio: 'Studio', ai_insights: 'Analysis', ai_recommendation: 'Recommendation', app_settings: 'Settings',
};
export const entityLabel = (t: string | null) => (t ? ENTITY_LABELS[t] ?? humanize(t) : '');

const HIDDEN = /pass|token|secret|key$/i;
const short = (v: unknown, n = 48): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return '…';
  const s = String(v); return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
/** "role: admin · email: x@y.com" from the details JSON (secrets hidden, at most 4 items). */
export function detailText(details: unknown): string {
  if (details == null || details === '') return '';
  if (typeof details !== 'object' || Array.isArray(details)) return short(details, 120);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (v == null || v === '' || v === '***' || HIDDEN.test(k)) continue;
    parts.push(`${humanize(k).toLowerCase()}: ${short(v)}`);
    if (parts.length === 4) break;
  }
  return parts.join(' · ');
}

/** What the row shows in the "Item" column. */
export function itemText(entityType: string | null, entityId: string | null, jobCode?: string | null): string {
  if (jobCode) return jobCode;
  if (!entityId) return entityLabel(entityType);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(entityId)) return `${entityLabel(entityType) || 'Item'} ${entityId.slice(0, 8)}`;
  return entityId.length > 40 ? entityId.slice(0, 39) + '…' : entityId;
}

/** One CSV cell. Cells that start with = + - @ get a leading apostrophe so a spreadsheet never runs them as a formula. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');
