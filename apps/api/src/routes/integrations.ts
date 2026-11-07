import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { one, q } from '../db/pool.js';
import { authenticate, requirePermission } from '../auth/auth.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { request } from '../lib/http.js';
import { graph, graphBase, META_SCOPES } from '../integrations/meta.js';
import { GOOGLE_SCOPES } from '../integrations/youtube.js';
import { saveToken } from '../integrations/tokens.js';
import { enqueue } from '../jobs/queue.js';
import { getSyncSettings } from '../sync/syncService.js';

const redirect = (p: 'meta' | 'google') => `${env.API_PUBLIC_URL}/api/integrations/${p}/callback`;

async function upsertAccount(platform: string, externalId: string, name: string, userId: string | null, extra: { handle?: string; avatar?: string; metadata?: any } = {}) {
  return (await one<{ id: string }>(
    `INSERT INTO social_accounts (platform_code, external_account_id, display_name, handle, avatar_url, connected_by, metadata, status, data_origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'connected','live')
     ON CONFLICT (platform_code, external_account_id) DO UPDATE SET display_name=EXCLUDED.display_name, handle=EXCLUDED.handle,
       avatar_url=EXCLUDED.avatar_url, status='connected', last_error=NULL, metadata=social_accounts.metadata || EXCLUDED.metadata, updated_at=now()
     RETURNING id`,
    [platform, externalId, name, extra.handle ?? null, extra.avatar ?? null, userId, JSON.stringify(extra.metadata ?? {})]))!.id;
}

/** From a Meta user token: exchange to long-lived, enumerate Pages + linked Instagram professional accounts. */
export async function connectMetaFromUserToken(userToken: string, userId: string | null) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error('META_APP_ID / META_APP_SECRET are not configured in .env');
  const ll = await request<any>(`${graphBase()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.META_APP_ID}&client_secret=${env.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(userToken)}`);
  const longToken: string = ll.access_token;
  const llExpires = ll.expires_in ? new Date(Date.now() + ll.expires_in * 1000) : new Date(Date.now() + 60 * 864e5);
  const pages = await graph<any>('me/accounts', { fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}', limit: 100 }, longToken);
  const connected: { platform: string; id: string; name: string }[] = [];
  for (const p of pages.data ?? []) {
    const fbId = await upsertAccount('facebook', p.id, p.name, userId, { avatar: p.picture?.data?.url });
    await saveToken(fbId, 'page_access', p.access_token, null, META_SCOPES); // page token from long-lived user token: no expiry
    await saveToken(fbId, 'long_lived_user', longToken, llExpires);
    connected.push({ platform: 'facebook', id: fbId, name: p.name });
    const ig = p.instagram_business_account;
    if (ig) {
      const igId = await upsertAccount('instagram', ig.id, ig.name ?? ig.username, userId, { handle: ig.username, avatar: ig.profile_picture_url, metadata: { facebook_page_id: p.id } });
      await saveToken(igId, 'page_access', p.access_token, null, META_SCOPES);
      await saveToken(igId, 'long_lived_user', longToken, llExpires);
      connected.push({ platform: 'instagram', id: igId, name: ig.username });
    }
  }
  if (!connected.length) throw new Error('No Facebook Pages found for this login. The user must have a role on the Page, and the Instagram account must be a Business/Creator account linked to that Page.');
  return connected;
}

export async function integrationRoutes(app: FastifyInstance) {
  // ---------- Status
  app.get('/api/integrations', { preHandler: authenticate }, async () => {
    const stale = (await getSyncSettings()).stale_after_hours;
    const accounts = await q<any>(
      `SELECT sa.id, sa.platform_code, sa.display_name, sa.handle, sa.avatar_url, sa.status, sa.data_origin, sa.last_synced_at, sa.last_sync_status, sa.last_error,
              sa.created_at, (SELECT min(expires_at) FROM social_account_tokens t WHERE t.social_account_id=sa.id AND t.expires_at IS NOT NULL) AS token_expires_at,
              (SELECT count(*)::int FROM platform_publications p WHERE p.social_account_id=sa.id) AS publications,
              (SELECT row_to_json(j) FROM (SELECT id, status, started_at, finished_at, metrics_written, error_count, error_summary FROM sync_jobs WHERE social_account_id=sa.id ORDER BY created_at DESC LIMIT 1) j) AS last_job
         FROM social_accounts sa WHERE sa.status <> 'disconnected' ORDER BY sa.platform_code, sa.display_name`);
    for (const a of accounts) {
      const ageH = a.last_synced_at ? (Date.now() - new Date(a.last_synced_at).getTime()) / 36e5 : null;
      a.health = a.data_origin === 'demo' ? 'demo' : a.status !== 'connected' ? a.status : ageH === null ? 'never_synced' : ageH > stale ? 'stale' : a.last_sync_status === 'partial' ? 'partial' : 'healthy';
    }
    return {
      accounts,
      configured: { meta: !!(env.META_APP_ID && env.META_APP_SECRET), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
      redirect_uris: { meta: redirect('meta'), google: redirect('google') },
      platforms: await q(`SELECT * FROM platforms WHERE kind='social' ORDER BY code`),
    };
  });

  app.get('/api/integrations/:id/logs', { preHandler: requirePermission('integrations.manage', 'sync.run') }, async (req) => {
    const { id } = req.params as any;
    return q(`SELECT level, endpoint, http_status, message, created_at FROM integration_logs WHERE social_account_id=$1 ORDER BY created_at DESC LIMIT 200`, [id]);
  });
  app.get('/api/sync-jobs', { preHandler: authenticate }, async () =>
    q(`SELECT j.*, sa.display_name, sa.platform_code FROM sync_jobs j LEFT JOIN social_accounts sa ON sa.id=j.social_account_id ORDER BY j.created_at DESC LIMIT 100`));

  app.post('/api/integrations/:id/sync', { preHandler: requirePermission('sync.run', 'integrations.manage') }, async (req) => {
    const { id } = req.params as any;
    const { backfill } = (req.body ?? {}) as any;
    await enqueue('sync-account', { accountId: id, triggeredBy: `user:${req.user_!.email}`, jobType: backfill ? 'backfill' : 'incremental' });
    await audit(req.user_!.id, 'sync.manual', 'social_account', id);
    return { queued: true };
  });
  app.post('/api/integrations/sync-all', { preHandler: requirePermission('sync.run', 'integrations.manage') }, async (req) => {
    await enqueue('sync-all', { triggeredBy: `user:${req.user_!.email}` });
    return { queued: true };
  });

  app.delete('/api/integrations/:id', { preHandler: requirePermission('integrations.manage') }, async (req) => {
    const { id } = req.params as any;
    await q(`DELETE FROM social_account_tokens WHERE social_account_id=$1`, [id]);
    await q(`UPDATE social_accounts SET status='disconnected', updated_at=now() WHERE id=$1`, [id]); // history is kept
    await audit(req.user_!.id, 'account.disconnect', 'social_account', id, null, req.ip);
    return { ok: true };
  });

  // ---------- Meta OAuth
  app.get('/api/integrations/meta/start', { preHandler: requirePermission('integrations.manage') }, async (req, reply) => {
    if (!env.META_APP_ID) return reply.code(400).send({ error: 'META_APP_ID not configured' });
    const state = randomToken();
    await q(`INSERT INTO oauth_states (state, provider, user_id) VALUES ($1,'meta',$2)`, [state, req.user_!.id]);
    const u = new URL(`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`);
    u.searchParams.set('client_id', env.META_APP_ID); u.searchParams.set('redirect_uri', redirect('meta'));
    u.searchParams.set('state', state); u.searchParams.set('scope', META_SCOPES.join(',')); u.searchParams.set('response_type', 'code');
    return reply.redirect(u.toString());
  });
  app.get('/api/integrations/meta/callback', async (req, reply) => {
    const { code, state, error_description } = req.query as any;
    const st = await one<any>(`DELETE FROM oauth_states WHERE state=$1 AND provider='meta' AND created_at > now() - interval '15 minutes' RETURNING user_id`, [state ?? '']);
    if (!st) return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent('Invalid or expired OAuth state')}`);
    if (!code) return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent(error_description ?? 'Authorization denied')}`);
    try {
      const tok = await request<any>(`${graphBase()}/oauth/access_token?client_id=${env.META_APP_ID}&client_secret=${env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirect('meta'))}&code=${encodeURIComponent(code)}`);
      const connected = await connectMetaFromUserToken(tok.access_token, st.user_id);
      await audit(st.user_id, 'account.connect', 'meta', null, { connected: connected.map((c) => `${c.platform}:${c.name}`) }, req.ip);
      for (const c of connected) await enqueue('sync-account', { accountId: c.id, triggeredBy: 'connect', jobType: 'backfill' });
      return reply.redirect(`${env.WEB_ORIGIN}/integrations?connected=${encodeURIComponent(connected.map((c) => c.name).join(', '))}`);
    } catch (e) {
      return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent((e as Error).message)}`);
    }
  });
  /** Quick start: paste a user access token from Graph API Explorer. */
  app.post('/api/integrations/meta/token', { preHandler: requirePermission('integrations.manage') }, async (req, reply) => {
    const { access_token } = z.object({ access_token: z.string().min(20) }).parse(req.body);
    try {
      const connected = await connectMetaFromUserToken(access_token, req.user_!.id);
      await audit(req.user_!.id, 'account.connect', 'meta', null, { method: 'token', connected: connected.map((c) => `${c.platform}:${c.name}`) }, req.ip);
      for (const c of connected) await enqueue('sync-account', { accountId: c.id, triggeredBy: 'connect', jobType: 'backfill' });
      return { connected };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---------- Google OAuth (YouTube)
  app.get('/api/integrations/google/start', { preHandler: requirePermission('integrations.manage') }, async (req, reply) => {
    if (!env.GOOGLE_CLIENT_ID) return reply.code(400).send({ error: 'GOOGLE_CLIENT_ID not configured' });
    const state = randomToken();
    await q(`INSERT INTO oauth_states (state, provider, user_id) VALUES ($1,'google',$2)`, [state, req.user_!.id]);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect('google'), response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).forEach(([k, v]) => u.searchParams.set(k, v));
    return reply.redirect(u.toString());
  });
  app.get('/api/integrations/google/callback', async (req, reply) => {
    const { code, state, error } = req.query as any;
    const st = await one<any>(`DELETE FROM oauth_states WHERE state=$1 AND provider='google' AND created_at > now() - interval '15 minutes' RETURNING user_id`, [state ?? '']);
    if (!st) return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent('Invalid or expired OAuth state')}`);
    if (!code) return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent(error ?? 'Authorization denied')}`);
    try {
      const tok = await request<any>('https://oauth2.googleapis.com/token', { method: 'POST',
        form: { code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect('google'), grant_type: 'authorization_code' } });
      if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from https://myaccount.google.com/permissions and connect again.');
      const scopes = String(tok.scope ?? '').split(' ');
      const authH = { headers: { authorization: `Bearer ${tok.access_token}` } };
      const connected: { platform: string; id: string; name: string }[] = [];
      const store = async (id: string) => {
        await saveToken(id, 'refresh', tok.refresh_token, null, scopes);
        await saveToken(id, 'access', tok.access_token, new Date(Date.now() + tok.expires_in * 1000), scopes);
      };
      const ch = await request<any>('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', authH).catch(() => ({ items: [] }));
      for (const c of ch.items ?? []) {
        const id = await upsertAccount('youtube', c.id, c.snippet.title, st.user_id, { handle: c.snippet.customUrl, avatar: c.snippet.thumbnails?.default?.url });
        await store(id); connected.push({ platform: 'youtube', id, name: c.snippet.title });
      }
      if (!connected.length) throw new Error('No YouTube channel found for this Google account. Choose the account (or Brand Account) that owns the channel.');
      await audit(st.user_id, 'account.connect', 'google', null, { connected: connected.map((c) => `${c.platform}:${c.name}`) }, req.ip);
      for (const c of connected) await enqueue('sync-account', { accountId: c.id, triggeredBy: 'connect', jobType: 'backfill' });
      return reply.redirect(`${env.WEB_ORIGIN}/integrations?connected=${encodeURIComponent(connected.map((c) => c.name).join(', '))}`);
    } catch (e) {
      return reply.redirect(`${env.WEB_ORIGIN}/integrations?error=${encodeURIComponent((e as Error).message)}`);
    }
  });
}
