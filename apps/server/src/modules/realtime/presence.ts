import { redis } from '../../lib/redis.js';

/**
 * Presence with a short TTL. Backed by Redis when configured (so it's shared
 * across instances); otherwise an in-memory store with the same TTL semantics
 * (correct for a single instance). All calls are best-effort — presence never
 * crashes the socket layer.
 */
export const PRESENCE_TTL_SEC = 60;

export type PresenceValue = 'ONLINE' | 'AWAY' | 'DND' | 'OFFLINE' | 'INVISIBLE';

const key = (profileId: string) => `presence:${profileId}`;

// In-memory fallback used when Redis isn't configured (single-instance deploys).
const mem = new Map<string, { status: PresenceValue; exp: number }>();

export async function setPresence(profileId: string, status: PresenceValue): Promise<void> {
  if (!redis) {
    mem.set(profileId, { status, exp: Date.now() + PRESENCE_TTL_SEC * 1000 });
    return;
  }
  try {
    await redis.set(key(profileId), status, 'EX', PRESENCE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

export async function refreshPresence(profileId: string): Promise<void> {
  if (!redis) {
    const e = mem.get(profileId);
    if (e) e.exp = Date.now() + PRESENCE_TTL_SEC * 1000;
    return;
  }
  try {
    await redis.expire(key(profileId), PRESENCE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

export async function clearPresence(profileId: string): Promise<void> {
  if (!redis) {
    mem.delete(profileId);
    return;
  }
  try {
    await redis.del(key(profileId));
  } catch {
    /* best-effort */
  }
}

export async function getPresence(profileId: string): Promise<PresenceValue> {
  if (!redis) {
    const e = mem.get(profileId);
    if (!e || e.exp < Date.now()) return 'OFFLINE';
    return e.status;
  }
  try {
    return ((await redis.get(key(profileId))) as PresenceValue | null) ?? 'OFFLINE';
  } catch {
    return 'OFFLINE';
  }
}
