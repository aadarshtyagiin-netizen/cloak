import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { searchService } from './search.service.js';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { q } = z.object({ q: z.string().max(200).optional().default('') }).parse(req.query);
    const { profileId } = currentIdentity(req);
    return { data: await searchService.searchMessages(profileId, q) };
  });
}
