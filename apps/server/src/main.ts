import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { buildApp } from './app.js';
import { config, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { createRedis, redisEnabled } from './lib/redis.js';
import { createRealtime } from './modules/realtime/gateway.js';
import { ensureStorage } from './lib/storage.js';
import { verifyEmailTransport } from './modules/auth/email.js';

async function main(): Promise<void> {
  await ensureStorage();
  await verifyEmailTransport();
  const app = await buildApp();
  await app.ready();

  // Attach Socket.IO to Fastify's underlying HTTP server.
  const io = new Server(app.server, {
    // Dev reflects the handshake origin (ngrok/LAN/localhost); prod pins it.
    cors: { origin: isProd ? config.WEB_ORIGIN : true, credentials: true },
    serveClient: false,
  });

  // Optional Redis adapter for horizontal fan-out across API nodes. Only enabled
  // when REDIS_URL is set — otherwise the default in-memory adapter is used,
  // which correctly delivers broadcasts on a single instance.
  if (redisEnabled) {
    try {
      const pub = createRedis();
      const sub = pub.duplicate();
      // Namespace per environment so a shared Redis (e.g. one Upstash DB used by
      // both dev and prod) never cross-delivers broadcasts between them.
      io.adapter(createAdapter(pub, sub, { key: `cloak:${config.NODE_ENV}` }));
      logger.info('socket.io redis adapter enabled');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown' },
        'redis adapter unavailable; using in-memory adapter (single node)',
      );
    }
  } else {
    logger.info('REDIS_URL not set — using in-memory Socket.IO adapter (single node)');
  }

  // Replace the placeholder gateway with the live one (see app.ts).
  app.realtime = createRealtime(io);

  // Hosts like Render/Railway inject PORT; fall back to SERVER_PORT locally.
  const port = Number(process.env.PORT) || config.SERVER_PORT;
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`🕶️  Cloak API listening on http://localhost:${port}`);
  logger.info(`   Real-time namespace: /rt  ·  CORS origin: ${config.WEB_ORIGIN}`);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'fatal startup error');
  process.exit(1);
});
