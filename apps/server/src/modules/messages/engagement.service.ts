import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicMessage, type PublicMessage } from '../../common/mappers.js';
import { assertChannelAccess } from '../channels/channels.service.js';
import { messageInclude } from '../../common/messageInclude.js';

// ---- Bookmarks (private to the caller) ----

export async function toggleBookmark(
  profileId: string,
  messageId: string,
): Promise<{ bookmarked: boolean }> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw AppError.notFound('Message');

  const existing = await prisma.bookmark.findUnique({
    where: { profileId_messageId: { profileId, messageId } },
  });
  if (existing) {
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return { bookmarked: false };
  }
  await prisma.bookmark.create({ data: { profileId, messageId } });
  return { bookmarked: true };
}

export interface BookmarkView {
  bookmarkedAt: string;
  message: PublicMessage;
}

export async function listBookmarks(profileId: string, limit = 50): Promise<BookmarkView[]> {
  const rows = await prisma.bookmark.findMany({
    where: { profileId, message: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: { message: { include: messageInclude } },
  });
  return rows.map((b) => ({
    bookmarkedAt: b.createdAt.toISOString(),
    message: toPublicMessage(b.message, profileId),
  }));
}

// ---- Pins (per channel, visible to all members) ----

export async function togglePin(
  channelId: string,
  messageId: string,
  profileId: string,
): Promise<{ pinned: boolean }> {
  await assertChannelAccess(channelId, profileId);
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, deletedAt: true },
  });
  if (!message || message.deletedAt || message.channelId !== channelId) {
    throw AppError.notFound('Message');
  }
  const existing = await prisma.pin.findUnique({
    where: { channelId_messageId: { channelId, messageId } },
  });
  if (existing) {
    await prisma.pin.delete({ where: { id: existing.id } });
    return { pinned: false };
  }
  await prisma.pin.create({ data: { channelId, messageId, pinnedByProfileId: profileId } });
  return { pinned: true };
}

export interface PinView {
  pinnedAt: string;
  message: PublicMessage;
}

export async function listPins(channelId: string, profileId: string): Promise<PinView[]> {
  await assertChannelAccess(channelId, profileId);
  const rows = await prisma.pin.findMany({
    where: { channelId, message: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    include: { message: { include: messageInclude } },
  });
  return rows.map((p) => ({
    pinnedAt: p.createdAt.toISOString(),
    message: toPublicMessage(p.message, profileId),
  }));
}

export const engagementService = { toggleBookmark, listBookmarks, togglePin, listPins };
