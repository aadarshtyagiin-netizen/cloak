import type { FastifyInstance } from 'fastify';
import { currentIdentity } from '../../plugins/auth.js';
import { AppError } from '../../lib/errors.js';
import { verifyMediaToken } from '../../lib/media.js';
import { storage } from '../../lib/storage.js';
import { mediaService } from './media.service.js';

function numField(fields: unknown, key: string): number | undefined {
  const f = (fields as Record<string, { value?: string } | undefined> | undefined)?.[key];
  const n = f?.value != null ? Number(f.value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  // Upload a single file (multipart). Returns a signed, ready-to-use media URL.
  app.post('/', { preHandler: app.authGuard }, async (req, reply) => {
    const { profileId } = currentIdentity(req);
    const data = await req.file();
    if (!data) throw AppError.conflict('No file uploaded.');
    const buffer = await data.toBuffer();
    const attachment = await mediaService.createAttachment(profileId, {
      buffer,
      mime: data.mimetype || 'application/octet-stream',
      durationMs: numField(data.fields, 'durationMs'),
      width: numField(data.fields, 'width'),
      height: numField(data.fields, 'height'),
    });
    return reply.code(201).send({ attachment: mediaService.toPublicUpload(attachment) });
  });

  // Stream a file. No auth guard — the signed token in the query IS the
  // capability, so <img>/<video>/<audio> tags can load it same-origin (incl. via ngrok).
  // Supports HTTP Range so audio/video can seek and so Safari/iOS will play at all.
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/:id', async (req, reply) => {
    const { id } = req.params;
    if (!verifyMediaToken(id, req.query.token)) {
      throw AppError.forbidden('Invalid or expired media link.');
    }
    const att = await mediaService.getAttachment(id);
    if (!att || !(await storage.exists(att.storageKey))) throw AppError.notFound('Media');

    const size = att.size;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header('Content-Disposition', `inline; filename="cloak-${att.id}"`);
    reply.type(att.mime);

    const rangeHeader = req.headers.range;
    const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
    if (match) {
      let start = match[1] ? Number.parseInt(match[1], 10) : 0;
      let end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end >= size) end = size - 1;
      if (start > end || start >= size || start < 0) {
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
      reply.header('Content-Length', (end - start + 1).toString());
      return reply.send(await storage.getStream(att.storageKey, { start, end }));
    }

    reply.header('Content-Length', size.toString());
    return reply.send(await storage.getStream(att.storageKey));
  });
}
