import { Prisma } from '@prisma/client';
import type { ChannelMember } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicChannel, toPublicProfile, type PublicChannel, type PublicProfile } from '../../common/mappers.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export interface CreateChannelInput {
  slug: string;
  name: string;
  description?: string;
  topic?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
}

async function getChannelOrThrow(channelId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw AppError.notFound('Channel');
  return channel;
}

/** Read access: public channels are readable by all; private require membership. */
export async function assertChannelAccess(channelId: string, profileId: string) {
  const channel = await getChannelOrThrow(channelId);
  if (channel.visibility === 'PRIVATE') {
    const member = await prisma.channelMember.findUnique({
      where: { channelId_profileId: { channelId, profileId } },
    });
    if (!member) throw AppError.forbidden('This channel is private.');
  }
  return channel;
}

/** Ensure the caller is a member (auto-joins public channels). Required to post. */
export async function ensureMembership(channelId: string, profileId: string): Promise<ChannelMember> {
  const channel = await getChannelOrThrow(channelId);
  const existing = await prisma.channelMember.findUnique({
    where: { channelId_profileId: { channelId, profileId } },
  });
  if (existing) return existing;
  if (channel.visibility === 'PRIVATE') throw AppError.forbidden('This channel is private.');
  if (channel.isArchived) throw AppError.forbidden('This channel is archived.');
  return prisma.channelMember.create({ data: { channelId, profileId } });
}

export async function listChannels(profileId: string): Promise<PublicChannel[]> {
  const channels = await prisma.channel.findMany({
    where: {
      OR: [{ visibility: 'PUBLIC' }, { members: { some: { profileId } } }],
    },
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { members: true } } },
  });
  return channels.map((c) => toPublicChannel(c, c._count.members));
}

export async function getChannel(channelId: string, profileId: string): Promise<PublicChannel> {
  const channel = await assertChannelAccess(channelId, profileId);
  const memberCount = await prisma.channelMember.count({ where: { channelId } });
  return toPublicChannel(channel, memberCount);
}

export async function createChannel(
  profileId: string,
  input: CreateChannelInput,
): Promise<PublicChannel> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw AppError.invalidUsername('Channel slug must be 2–32 lowercase letters, numbers, or dashes.');
  }
  const exists = await prisma.channel.findUnique({ where: { slug } });
  if (exists) throw AppError.conflict('A channel with that slug already exists.');

  try {
    const channel = await prisma.channel.create({
      data: {
        slug,
        name: input.name.trim(),
        description: input.description?.trim(),
        topic: input.topic?.trim(),
        visibility: input.visibility ?? 'PUBLIC',
        createdByProfileId: profileId,
        members: { create: { profileId, role: 'OWNER' } },
      },
    });
    return toPublicChannel(channel, 1);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict('A channel with that slug already exists.');
    }
    throw err;
  }
}

export async function joinChannel(channelId: string, profileId: string): Promise<PublicChannel> {
  await ensureMembership(channelId, profileId);
  return getChannel(channelId, profileId);
}

export async function leaveChannel(channelId: string, profileId: string): Promise<void> {
  await prisma.channelMember.deleteMany({ where: { channelId, profileId } });
}

export interface ChannelMemberView {
  profile: PublicProfile;
  role: ChannelMember['role'];
  joinedAt: string;
}

export async function listMembers(
  channelId: string,
  profileId: string,
): Promise<ChannelMemberView[]> {
  await assertChannelAccess(channelId, profileId);
  const members = await prisma.channelMember.findMany({
    where: { channelId },
    include: { profile: true },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((m) => ({
    profile: toPublicProfile(m.profile),
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

export const channelsService = {
  listChannels,
  getChannel,
  createChannel,
  joinChannel,
  leaveChannel,
  listMembers,
  assertChannelAccess,
  ensureMembership,
};
