import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { dmService } from './dm.service.js';

const openSchema = z.object({ profileId: z.string().min(1).max(64) });
const sendSchema = z.object({
  body: z.string().max(4000).optional().default(''),
  attachmentIds: z.array(z.string().min(1)).max(10).optional(),
});
const readSchema = z.object({ lastMessageId: z.string().min(1).max(64) });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export async function dmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await dmService.listThreads(profileId) };
  });

  app.post('/open', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { profileId: other } = openSchema.parse(req.body);
    const thread = await dmService.openThread(profileId, other);
    return reply.code(200).send({ thread });
  });

  app.get<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      const { limit, cursor } = listQuery.parse(req.query);
      return dmService.listMessages(req.params.id, profileId, { limit, cursor });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: app.authGuard },
    async (req, reply) => {
      const { profileId } = currentIdentity(req);
      const { body, attachmentIds } = sendSchema.parse(req.body);
      const message = await dmService.sendMessage(req.params.id, profileId, { body, attachmentIds });
      return reply.code(201).send({ message });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: app.authGuard },
    async (req, reply) => {
      const { profileId } = currentIdentity(req);
      const { lastMessageId } = readSchema.parse(req.body);
      await dmService.markThreadRead(req.params.id, profileId, lastMessageId);
      return reply.code(204).send();
    },
  );
}
