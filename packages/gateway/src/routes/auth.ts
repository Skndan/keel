import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createAccessToken, createRefreshToken, verifyToken, hashToken } from '../auth/jwt.ts';
import {
  generateOAuthState,
  storeOAuthState,
  consumeOAuthState,
  buildGoogleAuthUrl,
  buildGithubAuthUrl,
  exchangeGoogleCode,
  exchangeGithubCode,
  fetchGoogleUser,
  fetchGithubUser,
  upsertAccount,
} from '../auth/oauth.ts';
import { decryptOrNull } from '../auth/encryption.ts';
import { masterPool } from '../db.ts';
import { authMiddleware } from '../auth/middleware.ts';
import { config } from '../config.ts';
import { nanoid } from 'nanoid';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // Dashboard Auth — email/password login (replaces OAuth)
  // ═══════════════════════════════════════════════════════════

  // ─── POST /v1/auth/login — Dashboard login ────────────────
  app.post('/v1/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Email and password are required' },
      });
    }

    // Verify against ADMIN_EMAIL / ADMIN_PASSWORD from .env
    if (email !== config.adminEmail || password !== config.adminPassword) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    // Find or create an account record for the admin
    const { rows } = await masterPool.query(
      `INSERT INTO accounts (email, name, provider, provider_id)
       VALUES ($1, $2, 'email', $3)
       ON CONFLICT (provider, provider_id) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [email, 'Admin', email],
    );

    const accountId = rows[0].id;

    const accessToken = await createAccessToken(accountId);
    const refreshToken = await createRefreshToken(accountId);
    const tokenHash = await hashToken(refreshToken);

    await masterPool.query(
      `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [accountId, tokenHash, nanoid(16)],
    );

    return reply.send({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 900,
      },
    });
  });

  // ─── POST /v1/auth/refresh — Rotate refresh token ────────
  app.post('/v1/auth/refresh', async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token?: string };

    if (!refresh_token) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing refresh_token' } });
    }

    try {
      const payload = await verifyToken(refresh_token);

      if (payload.type !== 'refresh') {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token type' } });
      }

      const tokenHash = await hashToken(refresh_token);

      // Check token exists and is not revoked
      const { rows } = await masterPool.query(
        `SELECT id, family, account_id FROM refresh_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [tokenHash],
      );

      if (rows.length === 0) {
        // Token reuse detected — revoke the family
        await masterPool.query(
          `UPDATE refresh_tokens SET revoked_at = now()
           WHERE family = (SELECT family FROM refresh_tokens WHERE token_hash = $1)
           AND revoked_at IS NULL`,
          [tokenHash],
        );
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token revoked or expired' } });
      }

      const { family, account_id } = rows[0];

      // Revoke the used token
      await masterPool.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`,
        [tokenHash],
      );

      // Issue new tokens (rotation)
      const newAccessToken = await createAccessToken(account_id);
      const newRefreshToken = await createRefreshToken(account_id);
      const newTokenHash = await hashToken(newRefreshToken);

      await masterPool.query(
        `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [account_id, newTokenHash, family],
      );

      return reply.send({
        data: {
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          token_type: 'Bearer',
          expires_in: 900,
        },
      });
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
    }
  });

  // ─── GET /v1/auth/me — Get current user info ─────────────
  app.get('/v1/auth/me', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { rows } = await masterPool.query(
      `SELECT id, email, name, avatar_url, provider FROM accounts WHERE id = $1`,
      [req.accountId],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    }

    return reply.send({ data: rows[0] });
  });

  // ═══════════════════════════════════════════════════════════
  // Project-scoped OAuth — per-project Google/GitHub endpoints
  // ═══════════════════════════════════════════════════════════

  // ─── GET /v1/project/:slug/auth/google — Initiate Google OAuth ─
  app.get('/v1/project/:slug/auth/google', async (req, reply) => {
    const { slug } = req.params as { slug: string };

    try {
      const project = await getProjectOAuthConfig(slug);
      if (!project) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }
      if (!project.googleClientId || !project.googleClientSecret) {
        return reply.status(400).send({
          error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google OAuth not configured for this project' },
        });
      }

      const { state, codeVerifier } = generateOAuthState();
      await storeOAuthState(state, codeVerifier, 'google', `${config.baseUrl}/v1/project/${slug}/auth/google/callback`);

      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const params = new URLSearchParams({
        client_id: project.googleClientId,
        redirect_uri: `${config.baseUrl}/v1/project/${slug}/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initiate OAuth';
      return reply.status(500).send({ error: { code: 'OAUTH_INIT_FAILED', message } });
    }
  });

  // ─── GET /v1/project/:slug/auth/google/callback ──────────
  app.get('/v1/project/:slug/auth/google/callback', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return reply.status(400).send({ error: { code: 'OAUTH_ERROR', message: error } });
    }
    if (!code || !state) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing code or state' } });
    }

    const stored = await consumeOAuthState(state);
    if (!stored || stored.provider !== 'google') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Invalid or expired state' } });
    }

    try {
      const project = await getProjectOAuthConfig(slug);
      if (!project) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }
      if (!project.googleClientId || !project.googleClientSecret) {
        return reply.status(400).send({ error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google OAuth not configured' } });
      }

      // Exchange code with project's own Google credentials
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: project.googleClientId,
          client_secret: project.googleClientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${config.baseUrl}/v1/project/${slug}/auth/google/callback`,
          code_verifier: stored.code_verifier,
        }),
      });
      if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
      const tokens = await res.json();

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!userRes.ok) throw new Error(`Google userinfo failed: ${await userRes.text()}`);
      const userData = await userRes.json();

      const user = {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        avatar_url: userData.picture || null,
      };

      const accountId = await upsertAccount(user, 'google');

      const accessToken = await createAccessToken(accountId);
      const refreshToken = await createRefreshToken(accountId);
      const tokenHash = await hashToken(refreshToken);

      await masterPool.query(
        `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [accountId, tokenHash, nanoid(16)],
      );

      // Return user info (token-based auth for the project's users)
      return reply.send({
        data: {
          account_id: accountId,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 900,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OAuth failed';
      return reply.status(500).send({ error: { code: 'OAUTH_FAILED', message } });
    }
  });

  // ─── GET /v1/project/:slug/auth/github — Initiate GitHub OAuth ─
  app.get('/v1/project/:slug/auth/github', async (req, reply) => {
    const { slug } = req.params as { slug: string };

    try {
      const project = await getProjectOAuthConfig(slug);
      if (!project) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }
      if (!project.githubClientId || !project.githubClientSecret) {
        return reply.status(400).send({
          error: { code: 'OAUTH_NOT_CONFIGURED', message: 'GitHub OAuth not configured for this project' },
        });
      }

      const { state, codeVerifier } = generateOAuthState();
      await storeOAuthState(state, codeVerifier, 'github', `${config.baseUrl}/v1/project/${slug}/auth/github/callback`);

      const params = new URLSearchParams({
        client_id: project.githubClientId,
        redirect_uri: `${config.baseUrl}/v1/project/${slug}/auth/github/callback`,
        scope: 'user:email',
        state,
      });

      return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initiate OAuth';
      return reply.status(500).send({ error: { code: 'OAUTH_INIT_FAILED', message } });
    }
  });

  // ─── GET /v1/project/:slug/auth/github/callback ──────────
  app.get('/v1/project/:slug/auth/github/callback', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return reply.status(400).send({ error: { code: 'OAUTH_ERROR', message: error } });
    }
    if (!code || !state) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing code or state' } });
    }

    const stored = await consumeOAuthState(state);
    if (!stored || stored.provider !== 'github') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Invalid or expired state' } });
    }

    try {
      const project = await getProjectOAuthConfig(slug);
      if (!project) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }
      if (!project.githubClientId || !project.githubClientSecret) {
        return reply.status(400).send({ error: { code: 'OAUTH_NOT_CONFIGURED', message: 'GitHub OAuth not configured' } });
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: project.githubClientId,
          client_secret: project.githubClientSecret,
          code,
          redirect_uri: `${config.baseUrl}/v1/project/${slug}/auth/github/callback`,
        }),
      });
      if (!tokenRes.ok) throw new Error(`GitHub token exchange failed: ${await tokenRes.text()}`);
      const tokens = await tokenRes.json();

      const user = await fetchGithubUser(tokens.access_token);

      const accountId = await upsertAccount(user, 'github');

      const accessToken = await createAccessToken(accountId);
      const refreshToken = await createRefreshToken(accountId);
      const tokenHash = await hashToken(refreshToken);

      await masterPool.query(
        `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [accountId, tokenHash, nanoid(16)],
      );

      return reply.send({
        data: {
          account_id: accountId,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 900,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'OAuth failed';
      return reply.status(500).send({ error: { code: 'OAUTH_FAILED', message } });
    }
  });
}

// ─── Helper: Decrypt per-project OAuth config ──────────────

interface ProjectOAuthConfig {
  googleClientId: string | null;
  googleClientSecret: string | null;
  githubClientId: string | null;
  githubClientSecret: string | null;
}

async function getProjectOAuthConfig(slug: string): Promise<ProjectOAuthConfig | null> {
  const { rows } = await masterPool.query(
    `SELECT google_client_id, google_client_secret,
            github_client_id, github_client_secret
     FROM projects WHERE slug = $1`,
    [slug],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    googleClientId: decryptOrNull(row.google_client_id),
    googleClientSecret: decryptOrNull(row.google_client_secret),
    githubClientId: decryptOrNull(row.github_client_id),
    githubClientSecret: decryptOrNull(row.github_client_secret),
  };
}
