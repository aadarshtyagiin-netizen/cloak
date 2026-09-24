import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import { verifyAccessToken, type AuthIdentity } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

/**
 * Registers the authentication guard(s). `authGuard` verifies the Bearer access
 * token and attaches the public `identity` to the request; it never touches the
 * database, so it stays cheap on the hot path.
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest('identity', null);

  app.decorate('authGuard', async function authGuard(req: FastifyRequest) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw AppError.unauthenticated();
    const token = header.slice('Bearer '.length).trim();
    try {
      req.identity = await verifyAccessToken(token);
    } catch {
      throw AppError.sessionExpired();
    }
  });

  app.decorate('requireRole', (...roles: Role[]) => {
    return async function roleGuard(req: FastifyRequest) {
      if (!req.identity) throw AppError.unauthenticated();
      if (!roles.includes(req.identity.role)) throw AppError.forbidden();
    };
  });
});

/** Narrow `request.identity` to non-null (call inside guarded handlers). */
export function currentIdentity(req: FastifyRequest): AuthIdentity {
  if (!req.identity) throw AppError.unauthenticated();
  return req.identity;
}
