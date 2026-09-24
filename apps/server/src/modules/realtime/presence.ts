import { redis } from '../../lib/redis.js';

/**
 * Redis-backed presence with a short TTL. Heartbeats refresh the key; offline is
 * inferred from expiry, so we never write to Postgres on every heartbeat. All
 * calls are best-effort — if Redis is briefly unavailable, presence simply
 * degrades rather than crashing the socket layer.
 */
export const PRESENCE_TTL_SEC = 60;

export type PresenceValue = 'ONLINE' | 'AWAY' | 'DND' | 'OFFLINE' | 'INVISIBLE';

const key = (profileId: string) => `presence:${profileId}`;

export async function setPresence(profileId: string, status: PresenceValue): Promise<void> {
  try {
    await redis.set(key(profileId), status, 'EX', PRESENCE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

export async function refreshPresence(profileId: string): Promise<void> {
  try {
    await redis.expire(key(profileId), PRESENCE_TTL_SEC);
  } catch {
    /* best-effort */
  }
}

export async function clearPresence(profileId: string): Promise<void> {
  try {
    await redis.del(key(profileId));
  } catch {
    /* best-effort */
  }
}

export async function getPresence(profileId: string): Promise<PresenceValue> {
  try {
    return ((await redis.get(key(profileId))) as PresenceValue | null) ?? 'OFFLINE';
  } catch {
    return 'OFFLINE';
  }
}
