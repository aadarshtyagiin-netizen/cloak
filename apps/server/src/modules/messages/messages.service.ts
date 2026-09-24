import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicMessage, type PublicMessage } from '../../common/mappers.js';
import { decodeCursor, encodeCursor, type Page } from '../../common/pagination.js';
import { assertChannelAccess, ensureMembership } from '../channels/channels.service.js';
import { messageInclude } from '../../common/messageInclude.js';
import { gamificationService } from '../gamification/gamification.service.js';
import { notificationsService } from '../notifications/notifications.service.js';
import { threadsService } from './threads.service.js';
import { mediaService } from '../media/media.service.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BODY = 4000;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export interface ListMessagesOptions {
  limit?: number;
  cursor?: string | null;
}

/**
 * Cursor-paginated channel history, newest-first. Uses a keyset predicate over
 * the (createdAt, id) composite index — no OFFSET, so it stays fast deep into
 * history and avoids N+1 by including author + reactions in one query.
 */
export async function listChannelMessages(
  channelId: string,
  profileId: string,
  opts: ListMessagesOptions = {},
): Promise<Page<PublicMessage>> {
  await assertChannelAccess(channelId, profileId);
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const cursor = decodeCursor(opts.cursor);

  const rows = await prisma.message.findMany({
    where: {
      channelId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageInclude,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

  return { data: page.map((m) => toPublicMessage(m, profileId)), nextCursor };
}

export interface SendMessageInput {
  body: string;
  parentId?: string | null;
  attachmentIds?: string[];
  voice?: { attachmentId: string; durationMs: number; waveform: number[] };
}

export async function sendChannelMessage(
  channelId: string,
  profileId: string,
  input: SendMessageInput,
): Promise<PublicMessage> {
  const body = input.body.trim();
  const attachmentIds = input.attachmentIds ?? [];
  const isVoice = !!input.voice;
  const hasContent = body.length > 0 || attachmentIds.length > 0 || isVoice;
  if (!hasContent) throw AppError.conflict('Message cannot be empty.');
  if (body.length > MAX_BODY) throw AppError.conflict('Message is too long.');

  await ensureMembership(channelId, profileId);

  // Threading: a reply lazily creates/attaches to the parent's thread.
  let threadId: string | null = null;
  let rootAuthorId: string | null = null;
  if (input.parentId) {
    const parent = await prisma.message.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.channelId !== channelId) throw AppError.notFound('Parent message');
    const ensured = await threadsService.ensureThread(parent);
    threadId = ensured.threadId;
    rootAuthorId = ensured.rootAuthorId;
  }

  // Link uploaded attachments (incl. the voice audio) to this message.
  const allAttachmentIds = isVoice ? [...attachmentIds, input.voice!.attachmentId] : attachmentIds;

  // Fast path: a plain message (no attachments/voice) is created and returned
  // with all its relations in ONE round-trip. Attachment/voice messages must
  // create the link rows first, so they insert, link, then re-fetch.
  let message;
  if (allAttachmentIds.length === 0) {
    message = await prisma.message.create({
      data: {
        channelId,
        authorId: profileId,
        body,
        parentId: input.parentId ?? null,
        threadId,
        contentType: isVoice ? 'VOICE' : 'TEXT',
      },
      include: messageInclude,
    });
  } else {
    const created = await prisma.message.create({
      data: {
        channelId,
        authorId: profileId,
        body,
        parentId: input.parentId ?? null,
        threadId,
        contentType: isVoice ? 'VOICE' : 'TEXT',
      },
      select: { id: true },
    });
    await mediaService.linkAttachments(created.id, profileId, allAttachmentIds);
    if (input.voice) {
      await prisma.voiceMessage.create({
        data: {
          messageId: created.id,
          attachmentId: input.voice.attachmentId,
          durationMs: input.voice.durationMs,
          waveform: input.voice.waveform.slice(0, 256),
        },
      });
    }
    message = await prisma.message.findUnique({ where: { id: created.id }, include: messageInclude });
  }

  const finalMessage = message!;
  if (threadId) void threadsService.bumpReply(threadId);

  void gamificationService.awardXp(profileId, 'MESSAGE_SENT', { sourceType: 'message', sourceId: finalMessage.id });
  void gamificationService.touchStreak(profileId);
  if (threadId && rootAuthorId && rootAuthorId !== profileId) {
    void gamificationService.awardXp(rootAuthorId, 'THREAD_STARTED', { sourceType: 'thread', sourceId: threadId });
  }
  void notificationsService.notifyChannelMessage(
    { messageId: finalMessage.id, channelId, authorId: profileId, body },
    { rootAuthorId },
  );

  return toPublicMessage(finalMessage, profileId);
}

export async function editMessage(
  messageId: string,
  profileId: string,
  body: string,
): Promise<PublicMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw AppError.conflict('Message body cannot be empty.');
  if (trimmed.length > MAX_BODY) throw AppError.conflict('Message is too long.');

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw AppError.notFound('Message');
  if (message.authorId !== profileId) throw AppError.forbidden('You can only edit your own messages.');

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body: trimmed, editedAt: new Date() },
    include: messageInclude,
  });
  return toPublicMessage(updated, profileId);
}

export interface DeleteResult {
  id: string;
  channelId: string | null;
}

/** Soft-delete. Authors can delete their own; MODERATOR/ADMIN can delete any. */
export async function deleteMessage(
  messageId: string,
  actor: { profileId: string; role: Role },
): Promise<DeleteResult> {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw AppError.notFound('Message');

  const isOwner = message.authorId === actor.profileId;
  const isModerator = actor.role === 'MODERATOR' || actor.role === 'ADMIN';
  if (!isOwner && !isModerator) {
    throw AppError.forbidden('You can only delete your own messages.');
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), deletedByProfileId: actor.profileId },
  });
  return { id: message.id, channelId: message.channelId };
}

export const messagesService = {
  listChannelMessages,
  sendChannelMessage,
  editMessage,
  deleteMessage,
};
