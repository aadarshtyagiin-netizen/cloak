import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { roomsService } from './rooms.service.js';

const createSchema = z.object({ name: z.string().trim().max(80).optional().default('') });
const stateSchema = z.object({ patch: z.record(z.boolean()) });

export async function roomsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { kind: string } }>('/:kind', { preHandler: app.authGuard }, async (req) => {
    return { data: await roomsService.listRooms(req.params.kind) };
  });

  app.post<{ Params: { kind: string } }>('/:kind', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { name } = createSchema.parse(req.body ?? {});
    const room = await roomsService.createRoom(req.params.kind, profileId, name);
    return reply.code(201).send({ room });
  });

  app.get<{ Params: { kind: string; id: string } }>('/:kind/:id', { preHandler: app.authGuard }, async (req) => {
    return { room: await roomsService.getRoom(req.params.kind, req.params.id) };
  });

  app.post<{ Params: { kind: string; id: string } }>('/:kind/:id/join', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { room: await roomsService.joinRoom(req.params.kind, req.params.id, profileId) };
  });

  app.post<{ Params: { kind: string; id: string } }>('/:kind/:id/leave', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    await roomsService.leaveRoom(req.params.kind, req.params.id, profileId);
    return reply.code(204).send();
  });

  app.patch<{ Params: { kind: string; id: string } }>('/:kind/:id/state', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { patch } = stateSchema.parse(req.body);
    await roomsService.updateState(req.params.kind, req.params.id, profileId, patch);
    return reply.code(204).send();
  });

  // Mint a LiveKit access token to actually connect media.
  app.post<{ Params: { kind: string; id: string } }>('/:kind/:id/token', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return roomsService.issueRoomToken(req.params.kind, req.params.id, profileId);
  });
}
