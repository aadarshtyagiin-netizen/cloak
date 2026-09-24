import { Redis } from 'ioredis';
import { config } from '../config/env.js';

/**
 * Redis is OPTIONAL. It's only needed to scale realtime across multiple API
 * instances (Socket.IO adapter) and to share presence between them. When
 * REDIS_URL is unset (e.g. a single-instance deploy), the app uses the in-memory
 * Socket.IO adapter and an in-memory presence store — no Redis required.
 */
export const redisEnabled = config.REDIS_URL.length > 0;

/** Create a resilient Redis client (errors logged once, not per retry). */
export function createRedis(): Redis {
  let loggedError = false;
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => {
    if (loggedError) return;
    loggedError = true;
    console.warn(`[redis] connection error: ${err.message} (will keep retrying)`);
  });
  client.on('ready', () => {
    loggedError = false;
  });
  return client;
}

/** The shared client, or null when Redis isn't configured. */
export const redis: Redis | null = redisEnabled ? createRedis() : null;
