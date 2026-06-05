/**
 * HMAC-SHA256 signing for webhook payloads.
 * Creates a signature header that receivers can verify.
 */

/**
 * Sign a webhook payload with HMAC-SHA256.
 * Returns the signature as a hex string, suitable for X-Keel-Signature header.
 */
export async function signPayload(
  payload: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a webhook signature.
 */
export async function verifyPayload(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await signPayload(payload, secret);
  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(expected, signature);
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
