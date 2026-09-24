import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { communityService } from './community.service.js';

const eventSchema = z.object({
  channelId: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  startsAt: z.string().min(1),
  endsAt: z.string().optional(),
  location: z.string().trim().max(200).optional(),
});
const rsvpSchema = z.object({ status: z.enum(['GOING', 'MAYBE', 'NOT_GOING']) });
const answerSchema = z.object({ body: z.string().trim().min(1).max(500) });
const confessionSchema = z.object({ body: z.string().trim().min(3).max(1000) });

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  // Events
  app.get('/events', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await communityService.listEvents(profileId) };
  });
  app.post('/events', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const result = await communityService.createEvent(profileId, eventSchema.parse(req.body));
    return reply.code(201).send(result);
  });
  app.post<{ Params: { id: string } }>('/events/:id/rsvp', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { status } = rsvpSchema.parse(req.body);
    await communityService.rsvp(req.params.id, profileId, status);
    return reply.code(204).send();
  });

  // Icebreaker (question of the day)
  app.get('/icebreaker', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return communityService.getTodayIcebreaker(profileId);
  });
  app.post('/icebreaker/answer', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { body } = answerSchema.parse(req.body);
    await communityService.answerIcebreaker(profileId, body);
    return reply.code(204).send();
  });

  // Confessions (pre-moderated)
  app.get('/confessions', { preHandler: app.authGuard }, async () => {
    return { data: await communityService.listApprovedConfessions() };
  });
  app.post('/confessions', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { body } = confessionSchema.parse(req.body);
    const result = await communityService.submitConfession(profileId, body);
    return reply.code(202).send(result);
  });

  // Random pair chat
  app.post('/pairing/join', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return communityService.joinPairing(profileId);
  });
  app.get('/pairing/status', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return communityService.pairingStatus(profileId);
  });
  app.post('/pairing/leave', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    await communityService.leavePairing(profileId);
    return reply.code(204).send();
  });
}
