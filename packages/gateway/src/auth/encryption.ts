/**
 * Encryption utilities for storing per-project OAuth + R2 configs.
 * Uses AES-256-GCM with the ENCRYPTION_KEY from environment.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  // Use SHA-256 to derive a 32-byte key from any-length input
  return createHash('sha256').update(key).digest();
}

/**
 * Encrypt a string value with AES-256-GCM.
 * Returns base64-encoded "iv + authTag + ciphertext".
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'hex'),
  ]);

  return payload.toString('base64');
}

/**
 * Decrypt a value encrypted with encrypt().
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const payload = Buffer.from(encoded, 'base64');

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext).toString('utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Optionally encrypt — returns null if value is null/empty.
 */
export function encryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

/**
 * Optionally decrypt — returns null if value is null/empty.
 */
export function decryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return decrypt(value);
}
