import type { PollMode } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { messageInclude } from '../../common/messageInclude.js';
import { toPublicMessage, type PublicMessage, type PublicPoll } from '../../common/mappers.js';
import { ensureMembership } from '../channels/channels.service.js';
import { gamificationService } from '../gamification/gamification.service.js';
import { getRealtime } from '../realtime/emit.js';

export interface CreatePollInput {
  channelId: string;
  question: string;
  options: string[];
  mode?: PollMode;
  anonymous?: boolean;
  expiresInHours?: number;
}

/** Create a poll as a channel message (contentType POLL) and broadcast it. */
export async function createPoll(profileId: string, input: CreatePollInput): Promise<PublicMessage> {
  const question = input.question.trim();
  if (!question) throw AppError.conflict('A poll needs a question.');
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) throw AppError.conflict('A poll needs at least two options.');
  if (options.length > 10) throw AppError.conflict('A poll can have at most 10 options.');

  await ensureMembership(input.channelId, profileId);
  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3_600_000)
    : null;

  const created = await prisma.message.create({
    data: { channelId: input.channelId, authorId: profileId, body: question, contentType: 'POLL' },
    select: { id: true },
  });
  await prisma.poll.create({
    data: {
      channelId: input.channelId,
      messageId: created.id,
      createdByProfileId: profileId,
      question,
      mode: input.mode ?? 'SINGLE',
      anonymous: input.anonymous ?? true,
      expiresAt,
      options: { create: options.map((label, i) => ({ label, position: i })) },
    },
  });

  const message = await prisma.message.findUnique({ where: { id: created.id }, include: messageInclude });
  const dto = toPublicMessage(message!, profileId);
  getRealtime().emitMessageNew(input.channelId, dto);
  void gamificationService.awardXp(profileId, 'POLL_CREATED', { sourceType: 'poll', sourceId: created.id });
  return dto;
}

/** Cast (or replace) the caller's vote(s), then broadcast updated tallies. */
export async function vote(pollId: string, profileId: string, optionIds: string[]): Promise<PublicPoll> {
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } });
  if (!poll) throw AppError.notFound('Poll');
  if (poll.expiresAt && poll.expiresAt.getTime() < Date.now()) throw AppError.conflict('This poll has closed.');

  const valid = new Set(poll.options.map((o) => o.id));
  let chosen = optionIds.filter((id) => valid.has(id));
  if (chosen.length === 0) throw AppError.conflict('Pick at least one option.');
  if (poll.mode === 'SINGLE') chosen = [chosen[0]];

  await prisma.$transaction([
    prisma.pollVote.deleteMany({ where: { pollId, profileId } }),
    ...chosen.map((optionId) => prisma.pollVote.create({ data: { pollId, optionId, profileId } })),
  ]);

  const message = poll.messageId
    ? await prisma.message.findUnique({ where: { id: poll.messageId }, include: messageInclude })
    : null;
  if (!message) throw AppError.notFound('Poll');
  const dto = toPublicMessage(message, profileId);
  if (message.channelId && dto.poll) {
    getRealtime().emitPollUpdate(message.channelId, { messageId: message.id, poll: dto.poll });
  }
  return dto.poll!;
}

export const pollsService = { createPoll, vote };
