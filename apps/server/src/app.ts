import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { config, isProd } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { createNoopRealtime } from './modules/realtime/gateway.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { identityRoutes } from './modules/identity/identity.routes.js';
import { profilesRoutes } from './modules/profiles/profiles.routes.js';
import { channelsRoutes } from './modules/channels/channels.routes.js';
import { messagesRoutes } from './modules/messages/messages.routes.js';
import { bookmarksRoutes } from './modules/messages/bookmarks.routes.js';
import { gamificationRoutes } from './modules/gamification/gamification.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { dmRoutes } from './modules/dm/dm.routes.js';
import { moderationRoutes } from './modules/moderation/moderation.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { linkPreviewRoutes } from './modules/linkpreview/linkpreview.routes.js';
import { pollsRoutes } from './modules/polls/polls.routes.js';
import { communityRoutes } from './modules/community/community.routes.js';
import { roomsRoutes } from './modules/rooms/rooms.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB JSON bodies
    genReqId: () => randomUUID(),
  });

  // Security headers. CSP is applied on the web app tier, not this API.
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    // In dev we reflect the request origin so the app is reachable via ngrok /
    // LAN IP / localhost interchangeably. In prod we pin to the configured origin.
    origin: isProd ? config.WEB_ORIGIN : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie);

  // Multipart uploads (media). Single file per request, capped at MEDIA_MAX_BYTES.
  await app.register(multipart, {
    limits: { fileSize: config.MEDIA_MAX_BYTES, files: 1 },
  });

  // Global rate limit. NOTE: in-memory store is fine for single-node/dev;
  // configure the `redis` option for multi-node production deployments.
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Retry in ${Math.ceil(Number(context.ttl) / 1000)}s.`,
        details: { retryAfterSec: Math.ceil(Number(context.ttl) / 1000) },
      },
    }),
  });

  // Auth guards (decorates authGuard/requireRole). fp propagates to child scopes.
  await app.register(authPlugin);

  // Real-time gateway placeholder; replaced with the live one in main.ts.
  app.decorate('realtime', createNoopRealtime());

  // Error + not-found handlers MUST be set before routes so child plugin
  // contexts inherit them (Fastify resolves handlers at registration time).
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    // Fastify's own body/parsing validation.
    if ((err as { statusCode?: number }).statusCode === 400) {
      const message = err instanceof Error ? err.message : 'Invalid request.';
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
    }
    // Unknown → log full error server-side, return a generic message to client.
    req.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'cloak-api' }));

  // Versioned API surface.
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(identityRoutes, { prefix: '/identity' });
      await v1.register(profilesRoutes, { prefix: '/profiles' });
      await v1.register(channelsRoutes, { prefix: '/channels' });
      await v1.register(messagesRoutes, { prefix: '/messages' });
      await v1.register(bookmarksRoutes, { prefix: '/bookmarks' });
      await v1.register(gamificationRoutes, { prefix: '/gamification' });
      await v1.register(notificationsRoutes, { prefix: '/notifications' });
      await v1.register(dmRoutes, { prefix: '/dm' });
      await v1.register(moderationRoutes, { prefix: '/moderation' });
      await v1.register(mediaRoutes, { prefix: '/media' });
      await v1.register(linkPreviewRoutes, { prefix: '/link-preview' });
      await v1.register(pollsRoutes, { prefix: '/polls' });
      await v1.register(communityRoutes, { prefix: '/community' });
      await v1.register(roomsRoutes, { prefix: '/rooms' });
      await v1.register(adminRoutes, { prefix: '/admin' });
      await v1.register(searchRoutes, { prefix: '/search' });
    },
    { prefix: '/v1' },
  );

  return app;
}
