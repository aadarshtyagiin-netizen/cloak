import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentIdentity } from '../../plugins/auth.js';
import { adminService } from './admin.service.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const staff = { preHandler: [app.authGuard, app.requireRole('MODERATOR', 'ADMIN')] };
  const adminOnly = { preHandler: [app.authGuard, app.requireRole('ADMIN')] };

  app.get('/stats', staff, async () => adminService.getStats());

  app.get('/reports', staff, async (req) => {
    const { status } = z.object({ status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']).optional() }).parse(req.query);
    return { data: await adminService.listReports(status) };
  });

  app.post<{ Params: { id: string } }>('/reports/:id/resolve', staff, async (req, reply) => {
    const { status } = z.object({ status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']) }).parse(req.body);
    await adminService.resolveReport(req.params.id, status);
    return reply.code(204).send();
  });

  app.post<{ Params: { profileId: string } }>('/users/:profileId/action', staff, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { action, reason } = z
      .object({ action: z.enum(['SUSPEND', 'BAN', 'UNBAN']), reason: z.string().trim().max(500).optional().default('') })
      .parse(req.body);
    await adminService.actOnUser(profileId, req.params.profileId, action, reason);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/messages/:id/delete', staff, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { reason } = z.object({ reason: z.string().trim().max(500).optional().default('') }).parse(req.body ?? {});
    await adminService.deleteMessageAsMod(profileId, req.params.id, reason);
    return reply.code(204).send();
  });

  // Sensitive: real-identity unmask. ADMIN only + audited in the service.
  app.post<{ Params: { profileId: string } }>('/unmask/:profileId', adminOnly, async (req) => {
    const { profileId } = currentIdentity(req);
    return adminService.unmaskIdentity(profileId, req.params.profileId, req.ip);
  });

  app.get('/audit', adminOnly, async () => ({ data: await adminService.listAuditLog() }));

  // Config: badges
  app.get('/badges', staff, async () => ({ data: await adminService.listBadges() }));
  app.post('/badges', adminOnly, async (req, reply) => {
    const input = z
      .object({ key: z.string().trim().min(2).max(40), name: z.string().trim().min(1).max(60), emoji: z.string().min(1).max(8), description: z.string().trim().max(200) })
      .parse(req.body);
    const badge = await adminService.createBadge(input);
    return reply.code(201).send({ badge });
  });
  app.post<{ Params: { id: string } }>('/badges/:id/active', adminOnly, async (req, reply) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    await adminService.setBadgeActive(req.params.id, isActive);
    return reply.code(204).send();
  });

  // Config: reaction presets
  app.get('/reactions', staff, async () => ({ data: await adminService.listReactionPresets() }));
  app.post('/reactions', adminOnly, async (req, reply) => {
    const input = z.object({ key: z.string().trim().min(2).max(40), emoji: z.string().min(1).max(8), label: z.string().trim().min(1).max(40) }).parse(req.body);
    const preset = await adminService.createReactionPreset(input);
    return reply.code(201).send({ preset });
  });
  app.post<{ Params: { id: string } }>('/reactions/:id/active', adminOnly, async (req, reply) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    await adminService.setReactionPresetActive(req.params.id, isActive);
    return reply.code(204).send();
  });

  // Confession moderation queue
  app.get('/confessions/pending', staff, async () => ({ data: await adminService.moderatedConfessions() }));
  app.post<{ Params: { id: string } }>('/confessions/:id/moderate', staff, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    await adminService.moderateConfession(profileId, req.params.id, approve);
    return reply.code(204).send();
  });
}
