import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { channelsService } from './channels.service.js';
import { messagesService } from '../messages/messages.service.js';
import { engagementService } from '../messages/engagement.service.js';

const createChannelSchema = z.object({
  slug: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  topic: z.string().trim().max(200).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

const listMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const sendMessageSchema = z.object({
  body: z.string().max(4000).optional().default(''),
  parentId: z.string().min(1).optional(),
  attachmentIds: z.array(z.string().min(1)).max(10).optional(),
  voice: z
    .object({
      attachmentId: z.string().min(1),
      durationMs: z.number().int().positive(),
      waveform: z.array(z.number()).max(256),
    })
    .optional(),
});

export async function channelsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await channelsService.listChannels(profileId) };
  });

  app.post('/', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const input = createChannelSchema.parse(req.body);
    const channel = await channelsService.createChannel(profileId, input);
    return reply.code(201).send({ channel });
  });

  app.get<{ Params: { id: string } }>('/:id', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { channel: await channelsService.getChannel(req.params.id, profileId) };
  });

  app.post<{ Params: { id: string } }>('/:id/join', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { channel: await channelsService.joinChannel(req.params.id, profileId) };
  });

  app.post<{ Params: { id: string } }>('/:id/leave', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    await channelsService.leaveChannel(req.params.id, profileId);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/:id/members', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await channelsService.listMembers(req.params.id, profileId) };
  });

  // ---- Pinned messages ----

  app.get<{ Params: { id: string } }>('/:id/pins', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await engagementService.listPins(req.params.id, profileId) };
  });

  app.post<{ Params: { id: string } }>('/:id/pins', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { messageId } = z.object({ messageId: z.string().min(1).max(64) }).parse(req.body);
    return engagementService.togglePin(req.params.id, messageId, profileId);
  });

  // ---- Messages within a channel ----

  app.get<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      const { limit, cursor } = listMessagesQuery.parse(req.query);
      return messagesService.listChannelMessages(req.params.id, profileId, { limit, cursor });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: app.authGuard },
    async (req, reply) => {
      const { profileId } = currentIdentity(req);
      const input = sendMessageSchema.parse(req.body);
      const message = await messagesService.sendChannelMessage(req.params.id, profileId, input);
      // Fan out to everyone in the channel room in real time.
      app.realtime.emitMessageNew(req.params.id, message);
      return reply.code(201).send({ message });
    },
  );
}
