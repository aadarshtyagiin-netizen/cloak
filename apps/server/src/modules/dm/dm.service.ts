import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicMessage, toPublicProfile, type PublicMessage, type PublicProfile } from '../../common/mappers.js';
import { decodeCursor, encodeCursor, type Page } from '../../common/pagination.js';
import { gamificationService } from '../gamification/gamification.service.js';
import { notificationsService } from '../notifications/notifications.service.js';
import { getRealtime } from '../realtime/emit.js';
import { messageInclude } from '../../common/messageInclude.js';
import { mediaService } from '../media/media.service.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BODY = 4000;

/** Blocks are symmetric for DM purposes: neither party can message the other. */
async function assertNotBlocked(a: string, b: string): Promise<void> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerProfileId: a, blockedProfileId: b },
        { blockerProfileId: b, blockedProfileId: a },
      ],
    },
  });
  if (block) throw AppError.forbidden('You cannot message this person.');
}

async function assertParticipant(threadId: string, profileId: string): Promise<void> {
  const p = await prisma.dMParticipant.findUnique({
    where: { threadId_profileId: { threadId, profileId } },
  });
  if (!p) throw AppError.forbidden('You are not part of this conversation.');
}

async function otherParticipantId(threadId: string, profileId: string): Promise<string | null> {
  const others = await prisma.dMParticipant.findMany({
    where: { threadId, profileId: { not: profileId } },
    select: { profileId: true },
  });
  return others[0]?.profileId ?? null;
}

export interface DmThreadView {
  id: string;
  other: PublicProfile | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; createdAt: string; fromMe: boolean } | null;
  unread: number;
}

async function toThreadView(threadId: string, meId: string): Promise<DmThreadView> {
  const [thread, otherId, lastMessage] = await Promise.all([
    prisma.directMessageThread.findUnique({ where: { id: threadId } }),
    otherParticipantId(threadId, meId),
    prisma.message.findFirst({
      where: { dmThreadId: threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const me = await prisma.dMParticipant.findUnique({
    where: { threadId_profileId: { threadId, profileId: meId } },
  });
  const other = otherId
    ? await prisma.anonymousProfile.findUnique({ where: { id: otherId } })
    : null;

  // Unread = messages from the other party newer than my lastRead marker.
  let unread = 0;
  if (me?.lastReadMessageId) {
    const marker = await prisma.message.findUnique({
      where: { id: me.lastReadMessageId },
      select: { createdAt: true },
    });
    if (marker) {
      unread = await prisma.message.count({
        where: { dmThreadId: threadId, authorId: { not: meId }, createdAt: { gt: marker.createdAt } },
      });
    }
  } else {
    unread = await prisma.message.count({ where: { dmThreadId: threadId, authorId: { not: meId } } });
  }

  return {
    id: threadId,
    other: other ? toPublicProfile(other) : null,
    lastMessageAt: thread?.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
    lastMessage: lastMessage
      ? { body: lastMessage.body, createdAt: lastMessage.createdAt.toISOString(), fromMe: lastMessage.authorId === meId }
      : null,
    unread,
  };
}

export async function listThreads(profileId: string): Promise<DmThreadView[]> {
  const parts = await prisma.dMParticipant.findMany({
    where: { profileId },
    include: { thread: true },
    orderBy: { thread: { lastMessageAt: 'desc' } },
  });
  return Promise.all(parts.map((p) => toThreadView(p.threadId, profileId)));
}

/** Find or create the 1:1 DM thread between the caller and another profile. */
export async function openThread(profileId: string, otherProfileId: string): Promise<DmThreadView> {
  if (otherProfileId === profileId) throw AppError.conflict('You cannot DM yourself.');
  const other = await prisma.anonymousProfile.findUnique({ where: { id: otherProfileId } });
  if (!other) throw AppError.notFound('Profile');
  await assertNotBlocked(profileId, otherProfileId);

  const mine = await prisma.dMParticipant.findMany({
    where: { profileId },
    select: { threadId: true },
  });
  const existing = await prisma.directMessageThread.findFirst({
    where: {
      id: { in: mine.map((m) => m.threadId) },
      participants: { some: { profileId: otherProfileId } },
    },
    include: { _count: { select: { participants: true } } },
  });
  if (existing && existing._count.participants === 2) {
    return toThreadView(existing.id, profileId);
  }

  const created = await prisma.directMessageThread.create({
    data: { participants: { create: [{ profileId }, { profileId: otherProfileId }] } },
  });
  return toThreadView(created.id, profileId);
}

export async function listMessages(
  threadId: string,
  profileId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<Page<PublicMessage>> {
  await assertParticipant(threadId, profileId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = decodeCursor(opts.cursor);
  const rows = await prisma.message.findMany({
    where: {
      dmThreadId: threadId,
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
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { data: page.map((m) => toPublicMessage(m, profileId)), nextCursor };
}

export async function sendMessage(
  threadId: string,
  profileId: string,
  input: { body: string; attachmentIds?: string[] },
): Promise<PublicMessage> {
  const body = input.body.trim();
  const attachmentIds = input.attachmentIds ?? [];
  if (!body && attachmentIds.length === 0) throw AppError.conflict('Message cannot be empty.');
  if (body.length > MAX_BODY) throw AppError.conflict('Message is too long.');
  await assertParticipant(threadId, profileId);
  const otherId = await otherParticipantId(threadId, profileId);
  if (otherId) await assertNotBlocked(profileId, otherId);

  const created = await prisma.message.create({
    data: { dmThreadId: threadId, authorId: profileId, body, contentType: 'TEXT' },
    select: { id: true },
  });
  if (attachmentIds.length > 0) {
    await mediaService.linkAttachments(created.id, profileId, attachmentIds);
  }
  await prisma.directMessageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date() },
  });

  const full = await prisma.message.findUnique({ where: { id: created.id }, include: messageInclude });
  const dto = toPublicMessage(full!, profileId);
  const recipients = otherId ? [profileId, otherId] : [profileId];
  getRealtime().emitDmMessage(recipients, dto);

  void gamificationService.awardXp(profileId, 'MESSAGE_SENT', { sourceType: 'dm', sourceId: created.id });
  void gamificationService.touchStreak(profileId);
  if (otherId) {
    notificationsService.notifyDm({
      recipientId: otherId,
      actorProfileId: profileId,
      threadId,
      messageId: created.id,
      snippet: body || '📎 Attachment',
    });
  }
  return dto;
}

export async function markThreadRead(threadId: string, profileId: string, lastMessageId: string): Promise<void> {
  await prisma.dMParticipant.updateMany({
    where: { threadId, profileId },
    data: { lastReadMessageId: lastMessageId },
  });
}

export const dmService = { listThreads, openThread, listMessages, sendMessage, markThreadRead };
