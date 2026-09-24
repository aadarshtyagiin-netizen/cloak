import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { getPreferences, listNotifications, markRead, setPreference, unreadCount } from './notifications.service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
});

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { limit, unreadOnly } = listQuery.parse(req.query);
    return { data: await listNotifications(profileId, { limit, unreadOnly }) };
  });

  app.get('/unread-count', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { count: await unreadCount(profileId) };
  });

  // Mark specific ids read, or all when no ids are supplied.
  app.post('/read', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { ids } = markReadSchema.parse(req.body ?? {});
    await markRead(profileId, ids);
    return reply.code(204).send();
  });

  // Notification preferences (global + per-channel).
  app.get('/preferences', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return getPreferences(profileId);
  });

  app.put('/preferences', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { channelId, level } = z
      .object({
        channelId: z.string().min(1).max(64).nullable().optional(),
        level: z.enum(['ALL', 'MENTIONS', 'IMPORTANT', 'NOTHING']),
      })
      .parse(req.body);
    await setPreference(profileId, channelId ?? null, level);
    return reply.code(204).send();
  });
}
