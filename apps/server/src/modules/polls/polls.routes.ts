import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { pollsService } from './polls.service.js';

const createSchema = z.object({
  channelId: z.string().min(1).max(64),
  question: z.string().trim().min(1).max(280),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(10),
  mode: z.enum(['SINGLE', 'MULTI']).optional(),
  anonymous: z.boolean().optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});

const voteSchema = z.object({ optionIds: z.array(z.string().min(1)).min(1).max(10) });

export async function pollsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const input = createSchema.parse(req.body);
    const message = await pollsService.createPoll(profileId, input);
    return reply.code(201).send({ message });
  });

  app.post<{ Params: { id: string } }>('/:id/vote', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { optionIds } = voteSchema.parse(req.body);
    return { poll: await pollsService.vote(req.params.id, profileId, optionIds) };
  });
}
