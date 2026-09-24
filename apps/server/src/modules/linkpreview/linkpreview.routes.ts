import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { linkPreviewService } from './linkpreview.service.js';

const query = z.object({ url: z.string().url().max(2048) });

export async function linkPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.authGuard }, async (req) => {
    const { url } = query.parse(req.query);
    return linkPreviewService.getPreview(url);
  });
}
