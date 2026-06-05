import { jwtVerify } from 'jose';
import type { JwtPayload } from '@keel/types';

const DEFAULT_SECRET = () =>
  new TextEncoder().encode(
    process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars!!',
  );

/**
 * Verify a JWT token and return the payload.
 * Returns null if invalid or expired.
 */
export async function verifyJwt(token: string, secret?: Uint8Array): Promise<JwtPayload | null> {
  try {
    const key = secret || DEFAULT_SECRET();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    return {
      sub: payload.sub!,
      iat: payload.iat!,
      exp: payload.exp!,
      type: (payload.type as JwtPayload['type']) || 'access',
    };
  } catch {
    return null;
  }
}

/**
 * Verify a project API key against the stored hash.
 * Returns the project info if valid.
 */
export async function verifyApiKey(
  apiKey: string,
  pool: any,
): Promise<{ projectId: string; slug: string } | null> {
  try {
    const hash = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(apiKey))
      .then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );

    const { rows } = await pool.query(
      'SELECT id, slug, db_name FROM projects WHERE api_key_hash = $1',
      [hash],
    );

    if (rows.length === 0) return null;
    return { projectId: rows[0].id, slug: rows[0].slug };
  } catch {
    return null;
  }
}
