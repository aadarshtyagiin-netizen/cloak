import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { regenerateIdentity, setUsername } from './identity.service.js';

const setUsernameSchema = z.object({
  username: z.string().trim().min(3).max(24),
});

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  // Generate a brand-new anonymous identity (cooldown + daily cap enforced).
  app.post('/regenerate', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const profile = await regenerateIdentity(profileId);
    return { profile };
  });

  // Choose a custom (unique) anonymous username.
  app.patch('/username', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const { username } = setUsernameSchema.parse(req.body);
    const profile = await setUsername(profileId, username);
    return { profile };
  });
}
