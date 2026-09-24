import type { EventRSVPStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';
import { dmService } from '../dm/dm.service.js';

// ─────────────────────────── Events ───────────────────────────

export interface CreateEventInput {
  channelId?: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
}

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  createdBy: PublicProfile;
  counts: { going: number; maybe: number; notGoing: number };
  myStatus: EventRSVPStatus | null;
}

export async function createEvent(profileId: string, input: CreateEventInput): Promise<{ id: string }> {
  const title = input.title.trim();
  if (!title) throw AppError.conflict('An event needs a title.');
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw AppError.conflict('Invalid start time.');
  const event = await prisma.event.create({
    data: {
      channelId: input.channelId ?? null,
      createdByProfileId: profileId,
      title,
      description: input.description?.trim() || null,
      startsAt,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      location: input.location?.trim() || null,
    },
  });
  await prisma.eventRSVP.create({ data: { eventId: event.id, profileId, status: 'GOING' } });
  return { id: event.id };
}

export async function listEvents(profileId: string): Promise<EventView[]> {
  const since = new Date(Date.now() - 86_400_000);
  const events = await prisma.event.findMany({
    where: { startsAt: { gte: since } },
    orderBy: { startsAt: 'asc' },
    take: 50,
    include: { createdBy: true, rsvps: true },
  });
  return events.map((e) => {
    const counts = { going: 0, maybe: 0, notGoing: 0 };
    let myStatus: EventRSVPStatus | null = null;
    for (const r of e.rsvps) {
      if (r.status === 'GOING') counts.going += 1;
      else if (r.status === 'MAYBE') counts.maybe += 1;
      else counts.notGoing += 1;
      if (r.profileId === profileId) myStatus = r.status;
    }
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      location: e.location,
      createdBy: toPublicProfile(e.createdBy),
      counts,
      myStatus,
    };
  });
}

export async function rsvp(eventId: string, profileId: string, status: EventRSVPStatus): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw AppError.notFound('Event');
  await prisma.eventRSVP.upsert({
    where: { eventId_profileId: { eventId, profileId } },
    update: { status },
    create: { eventId, profileId, status },
  });
}

// ─────────────────────────── Icebreaker (question of the day) ───────────────────────────

const ICEBREAKER_PROMPTS = [
  'What is one technology you want to learn this year?',
  'Best meal you have had this week?',
  'What is a small win you had today?',
  'If you could automate one boring task, what would it be?',
  'Favorite keyboard shortcut nobody knows about?',
  'What is a book or article that changed how you think?',
  'Tabs or spaces — defend your answer. 😅',
  'What is your go-to focus music?',
];

function startOfUtcDay(d = new Date()): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export interface IcebreakerView {
  id: string;
  prompt: string;
  activeOn: string;
  myAnswer: string | null;
  answers: { id: string; body: string; author: PublicProfile; createdAt: string }[];
}

export async function getTodayIcebreaker(profileId: string): Promise<IcebreakerView> {
  const activeOn = startOfUtcDay();
  const dayIndex = Math.floor(activeOn.getTime() / 86_400_000);
  const prompt = ICEBREAKER_PROMPTS[dayIndex % ICEBREAKER_PROMPTS.length];
  const icebreaker = await prisma.icebreaker.upsert({
    where: { activeOn },
    update: {},
    create: { activeOn, prompt },
  });
  const answers = await prisma.icebreakerAnswer.findMany({
    where: { icebreakerId: icebreaker.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { profile: true },
  });
  return {
    id: icebreaker.id,
    prompt: icebreaker.prompt,
    activeOn: icebreaker.activeOn.toISOString(),
    myAnswer: answers.find((a) => a.profileId === profileId)?.body ?? null,
    answers: answers.map((a) => ({
      id: a.id,
      body: a.body,
      author: toPublicProfile(a.profile),
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function answerIcebreaker(profileId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw AppError.conflict('Write an answer first.');
  const icebreaker = await prisma.icebreaker.findUnique({ where: { activeOn: startOfUtcDay() } });
  if (!icebreaker) throw AppError.notFound('Icebreaker');
  await prisma.icebreakerAnswer.upsert({
    where: { icebreakerId_profileId: { icebreakerId: icebreaker.id, profileId } },
    update: { body: text.slice(0, 500) },
    create: { icebreakerId: icebreaker.id, profileId, body: text.slice(0, 500) },
  });
}

// ─────────────────────────── Confessions (pre-moderated) ───────────────────────────

export async function submitConfession(profileId: string, body: string): Promise<{ id: string }> {
  const text = body.trim();
  if (text.length < 3) throw AppError.conflict('Confession is too short.');
  const confession = await prisma.confession.create({
    data: { authorProfileId: profileId, body: text.slice(0, 1000), status: 'PENDING' },
  });
  return { id: confession.id };
}

export interface ConfessionView {
  id: string;
  body: string;
  publishedAt: string | null;
  createdAt: string;
}

/** Only APPROVED confessions are visible, and the author is never serialized. */
export async function listApprovedConfessions(): Promise<ConfessionView[]> {
  const rows = await prisma.confession.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }));
}

// ─────────────────────────── Random pair chat ───────────────────────────

export interface PairingResult {
  status: 'WAITING' | 'MATCHED';
  other: PublicProfile | null;
  threadId: string | null;
}

/** Opt-in matchmaking: pair the caller with another waiting member into a DM. */
export async function joinPairing(profileId: string): Promise<PairingResult> {
  const active = await prisma.randomPairSession.findFirst({
    where: {
      status: { in: ['WAITING', 'MATCHED'] },
      OR: [{ profileAId: profileId }, { profileBId: profileId }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (active?.status === 'MATCHED') return pairingStatus(profileId);
  if (active?.status === 'WAITING') return { status: 'WAITING', other: null, threadId: null };

  const waiting = await prisma.randomPairSession.findFirst({
    where: { status: 'WAITING', profileAId: { not: profileId } },
    orderBy: { createdAt: 'asc' },
  });

  if (waiting) {
    await prisma.randomPairSession.update({
      where: { id: waiting.id },
      data: { profileBId: profileId, status: 'MATCHED', startedAt: new Date() },
    });
    const thread = await dmService.openThread(waiting.profileAId, profileId);
    const other = await prisma.anonymousProfile.findUnique({ where: { id: waiting.profileAId } });
    return { status: 'MATCHED', other: other ? toPublicProfile(other) : null, threadId: thread.id };
  }

  await prisma.randomPairSession.create({ data: { profileAId: profileId, status: 'WAITING' } });
  return { status: 'WAITING', other: null, threadId: null };
}

export async function pairingStatus(profileId: string): Promise<PairingResult> {
  const session = await prisma.randomPairSession.findFirst({
    where: {
      status: { in: ['WAITING', 'MATCHED'] },
      OR: [{ profileAId: profileId }, { profileBId: profileId }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!session) return { status: 'WAITING', other: null, threadId: null };
  if (session.status === 'WAITING') return { status: 'WAITING', other: null, threadId: null };
  const otherId = session.profileAId === profileId ? session.profileBId : session.profileAId;
  if (!otherId) return { status: 'WAITING', other: null, threadId: null };
  const [other, thread] = await Promise.all([
    prisma.anonymousProfile.findUnique({ where: { id: otherId } }),
    dmService.openThread(profileId, otherId),
  ]);
  return { status: 'MATCHED', other: other ? toPublicProfile(other) : null, threadId: thread.id };
}

export async function leavePairing(profileId: string): Promise<void> {
  await prisma.randomPairSession.updateMany({
    where: { status: { in: ['WAITING', 'MATCHED'] }, OR: [{ profileAId: profileId }, { profileBId: profileId }] },
    data: { status: 'ENDED', endedAt: new Date() },
  });
}

export const communityService = {
  createEvent,
  listEvents,
  rsvp,
  getTodayIcebreaker,
  answerIcebreaker,
  submitConfession,
  listApprovedConfessions,
  joinPairing,
  pairingStatus,
  leavePairing,
};
