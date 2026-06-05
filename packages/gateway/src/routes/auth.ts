import type { FastifyInstance } from 'fastify';
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
import { masterPool } from '../db.ts';
import { authMiddleware } from '../auth/middleware.ts';
import { config } from '../config.ts';
import { nanoid } from 'nanoid';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /v1/auth/google — Initiate Google OAuth ─────────
  app.get('/v1/auth/google', async (_req, reply) => {
    try {
      const { state, codeVerifier } = generateOAuthState();
      await storeOAuthState(state, codeVerifier, 'google', `${config.baseUrl}/v1/auth/google/callback`);
      const url = buildGoogleAuthUrl(state, codeVerifier);
      return reply.redirect(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initiate OAuth';
      return reply.status(500).send({ error: { code: 'OAUTH_INIT_FAILED', message } });
    }
  });

  // ─── GET /v1/auth/google/callback — Google OAuth callback ─
  app.get('/v1/auth/google/callback', async (req, reply) => {
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
      const tokens = await exchangeGoogleCode(code, stored.code_verifier);
      const user = await fetchGoogleUser(tokens.access_token);
      const accountId = await upsertAccount(user, 'google');

      const accessToken = await createAccessToken(accountId);
      const refreshToken = await createRefreshToken(accountId);
      const tokenHash = await hashToken(refreshToken);

      await masterPool.query(
        `INSERT INTO refresh_tokens (account_id, token_hash, family, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [accountId, tokenHash, nanoid(16)],
      );

      // Return tokens as JSON (for SPAs) - redirect could go to dashboard
      return reply.send({
        data: {
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

  // ─── GET /v1/auth/github — Initiate GitHub OAuth ─────────
  app.get('/v1/auth/github', async (_req, reply) => {
    try {
      const { state, codeVerifier } = generateOAuthState();
      await storeOAuthState(state, codeVerifier, 'github', `${config.baseUrl}/v1/auth/github/callback`);
      const url = buildGithubAuthUrl(state, codeVerifier);
      return reply.redirect(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to initiate OAuth';
      return reply.status(500).send({ error: { code: 'OAUTH_INIT_FAILED', message } });
    }
  });

  // ─── GET /v1/auth/github/callback — GitHub OAuth callback ─
  app.get('/v1/auth/github/callback', async (req, reply) => {
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
      const tokens = await exchangeGithubCode(code);
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
}
