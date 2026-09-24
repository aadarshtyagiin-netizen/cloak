import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { getPublicProfile, updateMyProfile } from './profiles.service.js';

const updateProfileSchema = z.object({
  bio: z.string().trim().max(280).optional(),
  avatarKind: z.enum(['GENERATED', 'UPLOADED']).optional(),
  avatarSeed: z.string().trim().min(1).max(64).optional(),
  avatarUrl: z.string().url().max(2048).nullish(),
  presenceVisible: z.boolean().optional(),
});

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  // Update own profile — must be registered before the parameterized route.
  app.patch('/me', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const input = updateProfileSchema.parse(req.body);
    const profile = await updateMyProfile(profileId, input);
    return { profile };
  });

  // Public anonymous profile of any user.
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: app.authGuard },
    async (req) => {
      const profile = await getPublicProfile(req.params.id);
      return { profile };
    },
  );
}
