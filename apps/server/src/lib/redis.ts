import { Redis } from 'ioredis';
import { config } from '../config/env.js';

/**
 * Create a resilient Redis client. Connection errors are logged once (not per
 * retry) so the app can still boot for local dev / tests when Redis is briefly
 * unavailable. Presence + the Socket.IO adapter degrade gracefully.
 */
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

export const redis = createRedis();
