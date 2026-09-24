import 'fastify';
import type { preHandlerHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import type { AuthIdentity } from '../lib/tokens.js';
import type { RealtimeGateway } from '../modules/realtime/gateway.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `authGuard`. The public identity only — never internal ids. */
    identity: AuthIdentity | null;
  }

  interface FastifyInstance {
    /** preHandler that verifies the access token and attaches `request.identity`. */
    authGuard: preHandlerHookHandler;
    /** preHandler factory that requires one of the given roles. */
    requireRole: (...roles: Role[]) => preHandlerHookHandler;
    /** Real-time gateway for broadcasting to Socket.IO rooms from HTTP handlers. */
    realtime: RealtimeGateway;
  }
}
