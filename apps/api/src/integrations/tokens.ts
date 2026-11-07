import { one, q } from '../db/pool.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { env } from '../config.js';
import { ApiError, request } from '../lib/http.js';

type TokenType = 'access' | 'refresh' | 'page_access' | 'long_lived_user';

export async function saveToken(accountId: string, type: TokenType, value: string, expiresAt?: Date | null, scopes?: string[]) {
  await q(
    `INSERT INTO social_account_tokens (social_account_id, token_type, encrypted_value, expires_at, scopes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (social_account_id, token_type) DO UPDATE
       SET encrypted_value=EXCLUDED.encrypted_value, expires_at=EXCLUDED.expires_at,
           scopes=coalesce(EXCLUDED.scopes, social_account_tokens.scopes), updated_at=now()`,
    [accountId, type, encrypt(value), expiresAt ?? null, scopes ?? null],
  );
}

export async function getToken(accountId: string, type: TokenType): Promise<{ value: string; expires_at: Date | null } | null> {
  const r = await one<any>('SELECT encrypted_value, expires_at FROM social_account_tokens WHERE social_account_id=$1 AND token_type=$2', [accountId, type]);
  return r ? { value: decrypt(r.encrypted_value), expires_at: r.expires_at } : null;
}

export class TokenExpiredError extends Error {}

/** Google: return a valid access token, refreshing with the refresh token when needed. */
export async function googleAccessToken(accountId: string): Promise<string> {
  const at = await getToken(accountId, 'access');
  if (at && at.expires_at && at.expires_at.getTime() - Date.now() > 120_000) return at.value;
  const rt = await getToken(accountId, 'refresh');
  if (!rt) throw new TokenExpiredError('No Google refresh token stored. Reconnect the account.');
  try {
    const res = await request<any>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      form: { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: rt.value, grant_type: 'refresh_token' },
      retries: 2,
    });
    await saveToken(accountId, 'access', res.access_token, new Date(Date.now() + res.expires_in * 1000));
    return res.access_token;
  } catch (e) {
    if (e instanceof ApiError && (e.body?.error === 'invalid_grant' || e.status === 400 || e.status === 401)) {
      await q(`UPDATE social_accounts SET status='token_expired', last_error=$2 WHERE id=$1`, [accountId,
        'Google refresh token rejected (invalid_grant). If your OAuth app is in "Testing" mode tokens expire after 7 days — publish the app, then reconnect.']);
      throw new TokenExpiredError('Google refresh token expired or revoked');
    }
    throw e;
  }
}

/** Meta: page tokens derived from a long-lived user token do not expire, but can be invalidated (password change, role removal). */
export async function metaToken(accountId: string): Promise<string> {
  const t = (await getToken(accountId, 'page_access')) ?? (await getToken(accountId, 'access'));
  if (!t) throw new TokenExpiredError('No Meta token stored. Reconnect the account.');
  if (t.expires_at && t.expires_at.getTime() < Date.now()) {
    await q(`UPDATE social_accounts SET status='token_expired' WHERE id=$1`, [accountId]);
    throw new TokenExpiredError('Meta token expired');
  }
  return t.value;
}
