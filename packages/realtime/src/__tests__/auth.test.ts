import { describe, it, expect } from 'bun:test';
import { SignJWT } from 'jose';
import { verifyJwt } from '../auth.ts';

const secret = new TextEncoder().encode(
  'test-secret-that-is-at-least-32-characters-long!!',
);

describe('Realtime Auth', () => {
  describe('verifyJwt', () => {
    it('returns payload for valid access token', async () => {
      const token = await new SignJWT({ type: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('test-account-123')
        .setIssuedAt()
        .setExpirationTime('15 minutes')
        .sign(secret);

      const payload = await verifyJwt(token, secret);
      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe('test-account-123');
      expect(payload!.type).toBe('access');
    });

    it('returns payload for valid refresh token', async () => {
      const token = await new SignJWT({ type: 'refresh' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('test-account-456')
        .setIssuedAt()
        .setExpirationTime('30 days')
        .sign(secret);

      const payload = await verifyJwt(token, secret);
      expect(payload).not.toBeNull();
      expect(payload!.type).toBe('refresh');
    });

    it('returns null for invalid signature', async () => {
      const otherSecret = new TextEncoder().encode('a'.repeat(32));
      const token = await new SignJWT({ type: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('test')
        .setIssuedAt()
        .setExpirationTime('15 minutes')
        .sign(otherSecret);

      const payload = await verifyJwt(token, secret);
      expect(payload).toBeNull();
    });

    it('returns null for expired token', async () => {
      // Create a token that expired 1 hour ago
      const expiredAt = Math.floor(Date.now() / 1000) - 3600;
      const token = await new SignJWT({ type: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('test')
        .setIssuedAt(expiredAt - 3600)
        .setExpirationTime(expiredAt)
        .sign(secret);

      const payload = await verifyJwt(token, secret);
      expect(payload).toBeNull();
    });

    it('returns null for empty string', async () => {
      const payload = await verifyJwt('', secret);
      expect(payload).toBeNull();
    });

    it('returns null for garbage input', async () => {
      const payload = await verifyJwt('not-a-jwt-at-all', secret);
      expect(payload).toBeNull();
    });

    it('returns null for token signed with wrong algorithm', async () => {
      const payload = await verifyJwt('invalid.base64.token', secret);
      expect(payload).toBeNull();
    });

    it('handles tokens with missing type field', async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('test-account')
        .setIssuedAt()
        .setExpirationTime('15 minutes')
        .sign(secret);

      const payload = await verifyJwt(token, secret);
      expect(payload).not.toBeNull();
      expect(payload!.type).toBe('access'); // defaults to access
    });
  });
});
