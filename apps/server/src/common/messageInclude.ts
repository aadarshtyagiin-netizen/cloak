import type { Prisma } from '@prisma/client';

/**
 * The single canonical Prisma include for turning a Message row into a rich
 * client DTO (author, reactions, attachments, voice, poll). Every message query
 * uses this so the mapper always receives the same shape and no relation is
 * accidentally omitted.
 */
export const messageInclude = {
  author: true,
  reactions: true,
  attachments: true,
  voiceMessage: true,
  poll: {
    include: {
      options: { orderBy: { position: 'asc' } },
      votes: { select: { optionId: true, profileId: true } },
    },
  },
} satisfies Prisma.MessageInclude;

export type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
