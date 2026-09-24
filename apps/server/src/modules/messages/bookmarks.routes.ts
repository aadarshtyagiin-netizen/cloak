import type { FastifyInstance } from 'fastify';
import { currentIdentity } from '../../plugins/auth.js';
import { engagementService } from './engagement.service.js';

/** Mounted at /v1/bookmarks — the caller's saved messages. */
export async function bookmarksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return { data: await engagementService.listBookmarks(profileId) };
  });
}
