import type { Role } from '../types';

/**
 * Decode the caller's role from their own access-token JWT. This only reveals
 * the current user's role (never anyone else's) and needs no server round-trip.
 * Authorization is still enforced server-side on every admin route.
 */
export function decodeJwtRole(token: string | null): Role {
  if (!token) return 'USER';
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { role?: Role };
    return payload.role ?? 'USER';
  } catch {
    return 'USER';
  }
}
