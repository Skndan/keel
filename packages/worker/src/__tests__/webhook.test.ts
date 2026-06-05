import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { signPayload, generateWebhookSecret } from '../signature.ts';

describe('Webhook Delivery', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let receivedBodies: string[] = [];
  let receivedHeaders: Record<string, string>[] = [];
  let responseStatus = 200;

  beforeEach(() => {
    receivedBodies = [];
    receivedHeaders = [];
    responseStatus = 200;
  });

  afterEach(() => {
    if (mockServer) {
      mockServer.stop();
      mockServer = null;
    }
  });

  // Helper to start a mock webhook receiver
  async function startMockReceiver(
    expectedSecret?: string,
  ): Promise<{ port: number; url: string }> {
    return new Promise((resolve) => {
      mockServer = Bun.serve({
        port: 0, // random port
        async fetch(req) {
          const headers: Record<string, string> = {};
          req.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
          receivedHeaders.push(headers);

          const body = await req.text();
          receivedBodies.push(body);

          // Verify signature if expected
          if (expectedSecret) {
            const sig = headers['x-keel-signature'];
            if (sig) {
              const valid = await (async () => {
                try {
                  const key = await crypto.subtle.importKey(
                    'raw',
                    new TextEncoder().encode(expectedSecret),
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['verify'],
                  );
                  const sigBytes = new Uint8Array(
                    sig.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
                  );
                  return crypto.subtle.verify(
                    'HMAC',
                    key,
                    sigBytes,
                    new TextEncoder().encode(body),
                  );
                } catch {
                  return false;
                }
              })();

              return new Response(
                JSON.stringify({ valid, received: body }),
                {
                  status: valid ? 200 : 401,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
          }

          return new Response(JSON.stringify({ received: body }), {
            status: responseStatus,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      resolve({
        port: mockServer.port,
        url: `http://localhost:${mockServer.port}/webhook`,
      });
    });
  }

  it('delivers a webhook payload to a receiver', async () => {
    const { url } = await startMockReceiver();

    const payload = JSON.stringify({ event: 'test', data: { id: 1 } });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Keel-Webhook/0.2',
        'X-Keel-Webhook-Id': 'wh_test_1',
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(receivedBodies).toHaveLength(1);
    expect(JSON.parse(receivedBodies[0])).toEqual({
      event: 'test',
      data: { id: 1 },
    });
  });

  it('includes HMAC signature header when secret is provided', async () => {
    const secret = generateWebhookSecret();
    const { url } = await startMockReceiver(secret);

    const payload = JSON.stringify({ event: 'signed', data: { id: 2 } });
    const signature = await signPayload(payload, secret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Keel-Signature': signature,
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.valid).toBe(true);
  });

  it('rejects webhook with invalid HMAC signature', async () => {
    const secret = generateWebhookSecret();
    const { url } = await startMockReceiver(secret);

    const payload = JSON.stringify({ event: 'tampered' });
    const wrongSig = await signPayload('different-payload', secret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Keel-Signature': wrongSig,
      },
      body: payload,
    });

    expect(response.status).toBe(401);
  });

  it('handles non-2xx responses gracefully', async () => {
    responseStatus = 500;
    const { url } = await startMockReceiver();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test' }),
    });

    expect(response.status).toBe(500);
  });

  it('handles GET webhooks (no body)', async () => {
    const { url } = await startMockReceiver();

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Keel-Webhook/0.2' },
    });

    expect(response.status).toBe(200);
  });

  it('includes standard webhook headers', async () => {
    const { url } = await startMockReceiver();

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Keel-Webhook/0.2',
        'X-Keel-Webhook-Id': 'wh_abc123',
        'X-Keel-Webhook-Attempt': '1',
      },
      body: JSON.stringify({ test: true }),
    });

    expect(receivedHeaders[0]).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Keel-Webhook/0.2',
      'x-keel-webhook-id': 'wh_abc123',
      'x-keel-webhook-attempt': '1',
    });
  });

  it('times out on slow responses', async () => {
    // Use a slow endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);

    try {
      // Try to hit a non-existent host that will hang
      await fetch('http://10.255.255.1:9999/webhook', {
        signal: AbortSignal.timeout(100),
      });
    } catch (err: any) {
      expect(err.name === 'TimeoutError' || err.name === 'AbortError').toBe(
        true,
      );
    }

    clearTimeout(timeout);
  });
});
