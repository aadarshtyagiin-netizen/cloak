import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { getLeaderboard, getProfileOverview, listBadgeCatalog } from './gamification.service.js';

const leaderboardQuery = z.object({
  period: z.enum(['all', 'week']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function gamificationRoutes(app: FastifyInstance): Promise<void> {
  // My full gamification overview (XP, level, streak, badges, achievements, rank).
  app.get('/me/overview', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return getProfileOverview(profileId);
  });

  // Public overview of any anonymous profile (no real-identity fields).
  app.get<{ Params: { id: string } }>(
    '/profiles/:id/overview',
    { preHandler: app.authGuard },
    async (req) => getProfileOverview(req.params.id),
  );

  // Anonymous leaderboard.
  app.get('/leaderboard', { preHandler: app.authGuard }, async (req) => {
    const { period, limit } = leaderboardQuery.parse(req.query);
    return { period, data: await getLeaderboard(period, limit) };
  });

  // Badge catalog (admin-configurable set).
  app.get('/badges', { preHandler: app.authGuard }, async () => ({ data: await listBadgeCatalog() }));
}
