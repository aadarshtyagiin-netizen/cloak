import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { buildApp } from './app.js';
import { config, isProd } from './config/env.js';
import { logger } from './lib/logger.js';
import { createRedis } from './lib/redis.js';
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

  // Optional Redis adapter for horizontal fan-out across API nodes (best-effort).
  try {
    const pub = createRedis();
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('socket.io redis adapter enabled');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'redis adapter unavailable; using in-memory adapter (single node)',
    );
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
