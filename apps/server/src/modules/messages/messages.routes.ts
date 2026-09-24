import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { messagesService } from './messages.service.js';
import { reactionsService } from './reactions.service.js';
import { engagementService } from './engagement.service.js';
import { threadsService } from './threads.service.js';
import { notificationsService } from '../notifications/notifications.service.js';

const editMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(24),
});

export async function messagesRoutes(app: FastifyInstance): Promise<void> {
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      const { body } = editMessageSchema.parse(req.body);
      const message = await messagesService.editMessage(req.params.id, profileId, body);
      if (message.channelId) app.realtime.emitMessageUpdated(message.channelId, message);
      return { message };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: app.authGuard },
    async (req, reply) => {
      const identity = currentIdentity(req);
      const result = await messagesService.deleteMessage(req.params.id, identity);
      if (result.channelId) app.realtime.emitMessageDeleted(result.channelId, result.id);
      return reply.code(200).send({ id: result.id });
    },
  );

  // Toggle a reaction; fan out counts to the room and notify the author.
  app.post<{ Params: { id: string } }>(
    '/:id/reactions',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      const { emoji } = reactionSchema.parse(req.body);
      const result = await reactionsService.toggleReaction(req.params.id, profileId, emoji);
      if (result.channelId) {
        app.realtime.emitReactionUpdate(result.channelId, {
          messageId: result.messageId,
          counts: result.counts,
          actorProfileId: profileId,
          emoji: result.emoji,
          op: result.op,
        });
      }
      if (result.op === 'add' && result.authorId !== profileId) {
        notificationsService.notifyReaction({
          recipientId: result.authorId,
          actorProfileId: profileId,
          channelId: result.channelId,
          messageId: result.messageId,
          emoji: result.emoji,
        });
      }
      return { reactions: result.forViewer };
    },
  );

  // Toggle a personal bookmark on a message.
  app.post<{ Params: { id: string } }>(
    '/:id/bookmark',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      return engagementService.toggleBookmark(profileId, req.params.id);
    },
  );

  // Fetch a thread (root message + replies) rooted at this message.
  app.get<{ Params: { id: string } }>(
    '/:id/thread',
    { preHandler: app.authGuard },
    async (req) => {
      const { profileId } = currentIdentity(req);
      return threadsService.getThread(req.params.id, profileId);
    },
  );
}
