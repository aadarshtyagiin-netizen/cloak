import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Hash a low-entropy secret (e.g. an OTP) with scrypt + per-secret salt.
 * Format: "<saltHex>:<keyHex>". No native dependency (built into Node).
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(secret, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/** Constant-time verify against a value produced by {@link hashSecret}. */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = (await scryptAsync(secret, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Fast deterministic hash for high-entropy tokens (refresh tokens). */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Cryptographically strong numeric code of the given length (e.g. "482913"). */
export function generateNumericCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10).toString();
  return out;
}

/** URL-safe random token (used as the opaque refresh token). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
