import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { addKarma, awardXp } from '../gamification/gamification.service.js';

export interface ReactionCount {
  emoji: string;
  count: number;
}

export interface ReactionViewerSummary extends ReactionCount {
  reactedByMe: boolean;
}

export interface ToggleReactionResult {
  messageId: string;
  channelId: string | null;
  dmThreadId: string | null;
  authorId: string;
  op: 'add' | 'remove';
  emoji: string;
  /** Counts only — safe to broadcast to every recipient. */
  counts: ReactionCount[];
  /** Per-viewer summary (for the actor's own optimistic reconcile). */
  forViewer: ReactionViewerSummary[];
}

const EMOJI_MAX = 24;

async function aggregate(messageId: string, viewerId: string): Promise<{ counts: ReactionCount[]; forViewer: ReactionViewerSummary[] }> {
  const rows = await prisma.reaction.findMany({ where: { messageId } });
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const cur = map.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.profileId === viewerId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  const counts: ReactionCount[] = [];
  const forViewer: ReactionViewerSummary[] = [];
  for (const [emoji, v] of map) {
    counts.push({ emoji, count: v.count });
    forViewer.push({ emoji, count: v.count, reactedByMe: v.mine });
  }
  return { counts, forViewer };
}

/**
 * Toggle a reaction by (message, profile, emoji). Adding a reaction rewards the
 * message author with XP + karma (never the reactor, and never for self-reacts).
 */
export async function toggleReaction(
  messageId: string,
  profileId: string,
  emojiRaw: string,
): Promise<ToggleReactionResult> {
  const emoji = emojiRaw.trim();
  if (!emoji || emoji.length > EMOJI_MAX) throw AppError.conflict('Invalid reaction.');

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, dmThreadId: true, authorId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw AppError.notFound('Message');

  const existing = await prisma.reaction.findUnique({
    where: { messageId_profileId_emoji: { messageId, profileId, emoji } },
  });

  let op: 'add' | 'remove';
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    op = 'remove';
  } else {
    await prisma.reaction.create({ data: { messageId, profileId, emoji } });
    op = 'add';
    if (message.authorId !== profileId) {
      void awardXp(message.authorId, 'REACTION_RECEIVED', { sourceType: 'reaction', sourceId: messageId });
      void addKarma(message.authorId, 1);
    }
  }

  const { counts, forViewer } = await aggregate(messageId, profileId);
  return {
    messageId,
    channelId: message.channelId,
    dmThreadId: message.dmThreadId,
    authorId: message.authorId,
    op,
    emoji,
    counts,
    forViewer,
  };
}

export const reactionsService = { toggleReaction };
