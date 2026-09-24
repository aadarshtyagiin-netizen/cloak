import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { moderationService } from './moderation.service.js';

const reportSchema = z.object({
  targetType: z.enum(['MESSAGE', 'USER', 'CHANNEL']),
  targetProfileId: z.string().min(1).max(64).optional(),
  targetMessageId: z.string().min(1).max(64).optional(),
  targetChannelId: z.string().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(200),
  details: z.string().trim().max(1000).optional(),
});

const targetSchema = z.object({ profileId: z.string().min(1).max(64) });

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/reports', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const input = reportSchema.parse(req.body);
    const result = await moderationService.createReport(profileId, input);
    return reply.code(201).send(result);
  });

  app.get('/blocks', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await moderationService.listBlocks(profileId) };
  });

  app.post('/blocks', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { profileId: target } = targetSchema.parse(req.body);
    return moderationService.toggleBlock(profileId, target);
  });

  app.get('/mutes', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await moderationService.listMutes(profileId) };
  });

  app.post('/mutes', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { profileId: target } = targetSchema.parse(req.body);
    return moderationService.toggleMute(profileId, target);
  });
}
