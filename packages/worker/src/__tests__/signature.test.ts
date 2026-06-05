import { describe, it, expect } from 'bun:test';
import {
  signPayload,
  verifyPayload,
  generateWebhookSecret,
} from '../signature.ts';

describe('Signature — HMAC-SHA256', () => {
  describe('signPayload', () => {
    it('produces a 64-character hex signature', async () => {
      const sig = await signPayload('hello world', 'my-secret');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent signatures for same input', async () => {
      const sig1 = await signPayload('test payload', 'secret-key');
      const sig2 = await signPayload('test payload', 'secret-key');
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different payloads', async () => {
      const sig1 = await signPayload('payload-a', 'secret');
      const sig2 = await signPayload('payload-b', 'secret');
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different secrets', async () => {
      const sig1 = await signPayload('same payload', 'secret-a');
      const sig2 = await signPayload('same payload', 'secret-b');
      expect(sig1).not.toBe(sig2);
    });

    it('handles empty payload', async () => {
      const sig = await signPayload('', 'secret');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles JSON payloads', async () => {
      const payload = JSON.stringify({ type: 'test', data: { id: 1 } });
      const sig = await signPayload(payload, 'webhook-secret');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles unicode payloads', async () => {
      const sig = await signPayload('héllo wörld 🌍', 'secret');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('verifyPayload', () => {
    it('returns true for valid signature', async () => {
      const payload = 'test data';
      const secret = 'my-signing-secret';
      const sig = await signPayload(payload, secret);
      const valid = await verifyPayload(payload, sig, secret);
      expect(valid).toBe(true);
    });

    it('returns false for wrong secret', async () => {
      const payload = 'test data';
      const sig = await signPayload(payload, 'correct-secret');
      const valid = await verifyPayload(payload, sig, 'wrong-secret');
      expect(valid).toBe(false);
    });

    it('returns false for tampered payload', async () => {
      const sig = await signPayload('original', 'secret');
      const valid = await verifyPayload('tampered', sig, 'secret');
      expect(valid).toBe(false);
    });

    it('returns false for wrong length signature', async () => {
      const valid = await verifyPayload('data', 'short', 'secret');
      expect(valid).toBe(false);
    });

    it('returns false for empty signature', async () => {
      const valid = await verifyPayload('data', '', 'secret');
      expect(valid).toBe(false);
    });
  });

  describe('generateWebhookSecret', () => {
    it('generates a 64-character hex string', () => {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique secrets each time', () => {
      const s1 = generateWebhookSecret();
      const s2 = generateWebhookSecret();
      expect(s1).not.toBe(s2);
    });
  });
});
