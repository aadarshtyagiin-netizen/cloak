import type { Message } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicMessage, type PublicMessage } from '../../common/mappers.js';
import { assertChannelAccess } from '../channels/channels.service.js';
import { messageInclude } from '../../common/messageInclude.js';

export interface EnsuredThread {
  threadId: string;
  rootMessageId: string;
  rootAuthorId: string | null;
}

/**
 * Get (or lazily create) the thread a reply belongs to. Replies to any message
 * in a thread collapse onto the same root, giving flat Slack-style threads.
 */
export async function ensureThread(parent: Message): Promise<EnsuredThread> {
  let thread = parent.threadId
    ? await prisma.thread.findUnique({ where: { id: parent.threadId } })
    : await prisma.thread.findUnique({ where: { rootMessageId: parent.id } });

  if (!thread) {
    thread = await prisma.thread.create({
      data: { rootMessageId: parent.id, channelId: parent.channelId },
    });
  }

  const root = await prisma.message.findUnique({
    where: { id: thread.rootMessageId },
    select: { authorId: true },
  });
  return { threadId: thread.id, rootMessageId: thread.rootMessageId, rootAuthorId: root?.authorId ?? null };
}

/** Record a new reply against a thread. */
export async function bumpReply(threadId: string): Promise<void> {
  await prisma.thread.update({
    where: { id: threadId },
    data: { replyCount: { increment: 1 }, lastReplyAt: new Date() },
  });
}

export interface ThreadView {
  rootMessageId: string;
  replyCount: number;
  root: PublicMessage;
  replies: PublicMessage[];
}

/** Full thread: the root message plus its replies (oldest-first). */
export async function getThread(rootMessageId: string, profileId: string): Promise<ThreadView> {
  const root = await prisma.message.findUnique({
    where: { id: rootMessageId },
    include: messageInclude,
  });
  if (!root) throw AppError.notFound('Message');
  if (root.channelId) await assertChannelAccess(root.channelId, profileId);

  const thread = await prisma.thread.findUnique({ where: { rootMessageId } });
  const replies = thread
    ? await prisma.message.findMany({
        where: { threadId: thread.id, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: messageInclude,
      })
    : [];

  return {
    rootMessageId,
    replyCount: thread?.replyCount ?? 0,
    root: toPublicMessage(root, profileId),
    replies: replies.map((m) => toPublicMessage(m, profileId)),
  };
}

export const threadsService = { ensureThread, bumpReply, getThread };
