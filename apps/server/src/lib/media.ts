import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Signed capability URLs for private media. A media URL carries an HMAC over
 * (attachmentId, expiry) so it can be used by <img>/<video> tags (which can't
 * send Authorization headers) and still works same-origin through the Vite
 * proxy / ngrok. The token is the capability — no session needed to fetch.
 */

const KEY = config.JWT_ACCESS_SECRET;
const DEFAULT_TTL_SEC = 3600;

export function signMediaToken(attachmentId: string, ttlSec = DEFAULT_TTL_SEC): string {
  const exp = Date.now() + ttlSec * 1000;
  const sig = createHmac('sha256', KEY).update(`${attachmentId}.${exp}`).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyMediaToken(attachmentId: string, token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac('sha256', KEY).update(`${attachmentId}.${exp}`).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Relative, same-origin URL that streams the attachment through the API. */
export function mediaUrl(attachmentId: string): string {
  return `/v1/media/${attachmentId}?token=${signMediaToken(attachmentId)}`;
}
