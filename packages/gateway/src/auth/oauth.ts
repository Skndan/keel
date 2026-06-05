import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { masterPool } from '../db.ts';
import { nanoid } from 'nanoid';

interface OAuthTokens {
  access_token: string;
  token_type: string;
  scope?: string;
}

interface OAuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

/**
 * Generate OAuth state with PKCE code verifier.
 */
export function generateOAuthState(): { state: string; codeVerifier: string } {
  const state = nanoid(32);
  const codeVerifier = nanoid(64);
  return { state, codeVerifier };
}

/**
 * Compute S256 code challenge from verifier (base64url, no padding).
 */
export function computeCodeChallenge(codeVerifier: string): string {
  return createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
}

/**
 * Store OAuth state in the database for verification later.
 */
export async function storeOAuthState(
  state: string,
  codeVerifier: string,
  provider: 'google' | 'github',
  redirectUri: string,
): Promise<void> {
  await masterPool.query(
    `INSERT INTO oauth_states (state, code_verifier, redirect_uri, provider, created_at, expires_at)
     VALUES ($1, $2, $3, $4, now(), now() + interval '10 minutes')`,
    [state, codeVerifier, redirectUri, provider],
  );
}

/**
 * Retrieve and delete an OAuth state (one-time use).
 */
export async function consumeOAuthState(
  state: string,
): Promise<{ code_verifier: string; redirect_uri: string; provider: 'google' | 'github' } | null> {
  const client = await masterPool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT code_verifier, redirect_uri, provider FROM oauth_states
       WHERE state = $1 AND expires_at > now()
       FOR UPDATE`,
      [state],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('DELETE FROM oauth_states WHERE state = $1', [state]);
    await client.query('COMMIT');
    return rows[0];
  } catch {
    await client.query('ROLLBACK');
    return null;
  } finally {
    client.release();
  }
}

/**
 * Build the Google OAuth authorization URL.
 */
export function buildGoogleAuthUrl(state: string, codeVerifier: string): string {
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.baseUrl}/v1/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Build the GitHub OAuth authorization URL.
 */
export function buildGithubAuthUrl(state: string, codeVerifier: string): string {
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.baseUrl}/v1/auth/github/callback`,
    scope: 'user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens (Google).
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${config.baseUrl}/v1/auth/google/callback`,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

/**
 * Exchange authorization code for tokens (GitHub).
 */
export async function exchangeGithubCode(
  code: string,
): Promise<OAuthTokens> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.baseUrl}/v1/auth/github/callback`,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${await res.text()}`);
  return res.json();
}

/**
 * Fetch Google user info.
 */
export async function fetchGoogleUser(accessToken: string): Promise<OAuthUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${await res.text()}`);
  const data = await res.json();
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    avatar_url: data.picture || null,
  };
}

/**
 * Fetch GitHub user info.
 */
export async function fetchGithubUser(accessToken: string): Promise<OAuthUser> {
  const [userRes, emailRes] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    }),
  ]);

  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${await userRes.text()}`);
  const user = await userRes.json();

  let email = user.email;
  if (!email && emailRes.ok) {
    const emails = await emailRes.json();
    const primary = emails.find((e: { primary: boolean; email: string }) => e.primary);
    email = primary?.email || emails[0]?.email;
  }

  return {
    id: String(user.id),
    email: email || `${user.login}@github.noreply`,
    name: user.name || user.login,
    avatar_url: user.avatar_url || null,
  };
}

/**
 * Find or create an account from OAuth user data.
 */
export async function upsertAccount(
  user: OAuthUser,
  provider: 'google' | 'github',
): Promise<string> {
  const { rows } = await masterPool.query(
    `INSERT INTO accounts (email, name, avatar_url, provider, provider_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, provider_id) DO UPDATE
       SET name = $2, avatar_url = $3, updated_at = now()
     RETURNING id`,
    [user.email, user.name, user.avatar_url, provider, user.id],
  );
  return rows[0].id;
}
