import { SignJWT, jwtVerify } from 'jose';
import type { JwtPayload } from '@keel/types';
import { config } from '../config.ts';

const alg = 'HS256';

/**
 * Create an access token (15 min expiry).
 */
export async function createAccessToken(accountId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ type: 'access' } satisfies Partial<JwtPayload>)
    .setProtectedHeader({ alg })
    .setSubject(accountId)
    .setIssuedAt(now)
    .setExpirationTime('15 minutes')
    .sign(config.jwtSecret);
}

/**
 * Create a refresh token (30 day expiry).
 */
export async function createRefreshToken(accountId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ type: 'refresh' } satisfies Partial<JwtPayload>)
    .setProtectedHeader({ alg })
    .setSubject(accountId)
    .setIssuedAt(now)
    .setExpirationTime('30 days')
    .setJti(crypto.randomUUID())
    .sign(config.jwtSecret);
}

/**
 * Verify a JWT and return the payload.
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, config.jwtSecret, {
    algorithms: [alg],
  });

  return {
    sub: payload.sub!,
    iat: payload.iat!,
    exp: payload.exp!,
    type: (payload.type as JwtPayload['type']) || 'access',
  };
}

/**
 * Hash a token string using SHA-256 for storage.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
