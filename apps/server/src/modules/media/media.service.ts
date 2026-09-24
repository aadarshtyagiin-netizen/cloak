import type { Attachment, AttachmentKind } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { storage } from '../../lib/storage.js';
import { toPublicAttachment, type PublicAttachment } from '../../common/mappers.js';

/**
 * MIME allow-list → attachment kind. Anything not matched is rejected, which
 * prevents arbitrary/executable uploads (the PRD's upload-safety requirement).
 */
function kindFromMime(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf') return 'PDF';
  const docs = new Set([
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ]);
  if (docs.has(mime)) return 'DOCUMENT';
  return null;
}

export interface UploadInput {
  buffer: Buffer;
  mime: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** Validate + persist an upload, returning the stored (READY) attachment. */
export async function createAttachment(uploaderProfileId: string, input: UploadInput): Promise<Attachment> {
  const kind = kindFromMime(input.mime);
  if (!kind) throw AppError.conflict('That file type is not allowed.');
  if (input.buffer.length === 0) throw AppError.conflict('Empty file.');
  if (input.buffer.length > config.MEDIA_MAX_BYTES) {
    throw AppError.conflict(`File too large (max ${Math.round(config.MEDIA_MAX_BYTES / 1_048_576)} MB).`);
  }

  const attachment = await prisma.attachment.create({
    data: {
      uploaderProfileId,
      storageKey: 'pending',
      mime: input.mime,
      size: input.buffer.length,
      kind,
      status: 'READY',
      durationMs: input.durationMs ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
    },
  });
  // Store under the attachment id, then record the key.
  await storage.put(attachment.id, input.buffer, input.mime);
  return prisma.attachment.update({ where: { id: attachment.id }, data: { storageKey: attachment.id } });
}

export function toPublicUpload(a: Attachment): PublicAttachment {
  // toPublicAttachment only reads fields present on Attachment.
  return toPublicAttachment(a as unknown as Parameters<typeof toPublicAttachment>[0]);
}

/**
 * Link previously-uploaded, still-unattached files (owned by the caller) to a
 * message. Returns the ids that were actually linked.
 */
export async function linkAttachments(
  messageId: string,
  uploaderProfileId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const owned = await prisma.attachment.findMany({
    where: { id: { in: attachmentIds }, uploaderProfileId, messageId: null },
    select: { id: true },
  });
  if (owned.length !== attachmentIds.length) {
    throw AppError.conflict('One or more attachments are invalid.');
  }
  await prisma.attachment.updateMany({
    where: { id: { in: attachmentIds }, uploaderProfileId, messageId: null },
    data: { messageId },
  });
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  return prisma.attachment.findUnique({ where: { id } });
}

export const mediaService = { createAttachment, linkAttachments, getAttachment, toPublicUpload };
