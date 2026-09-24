import type { AnonymousProfile, Channel, Reaction } from '@prisma/client';
import { AvatarKind, MessageContentType, PresenceStatus, ChannelVisibility, AttachmentKind, PollMode } from '@prisma/client';
import { mediaUrl } from '../lib/media.js';
import type { MessageWithRelations } from './messageInclude.js';

/**
 * THE ANONYMIZATION BOUNDARY.
 *
 * These are the ONLY sanctioned functions for turning database rows into
 * client-facing DTOs. They use explicit field allow-lists, so it is impossible
 * to accidentally serialize `authUserId`, `email`, `employeeId`, or any other
 * internal identity field. Routes must map through here before replying.
 */

export interface PublicProfile {
  id: string;
  username: string;
  avatarKind: AvatarKind;
  avatarSeed: string;
  avatarUrl: string | null;
  bio: string | null;
  karma: number;
  xp: number;
  level: number;
  presence: PresenceStatus;
  joinedAt: string;
}

export function toPublicProfile(p: AnonymousProfile): PublicProfile {
  const hidden = !p.presenceVisible || p.presenceStatus === PresenceStatus.INVISIBLE;
  return {
    id: p.id,
    username: p.username,
    avatarKind: p.avatarKind,
    avatarSeed: p.avatarSeed,
    avatarUrl: p.avatarUrl,
    bio: p.bio,
    karma: p.karma,
    xp: p.xp,
    level: p.level,
    presence: hidden ? PresenceStatus.OFFLINE : p.presenceStatus,
    joinedAt: p.createdAt.toISOString(),
  };
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

function aggregateReactions(reactions: Reaction[], myProfileId?: string): (ReactionSummary & { reactedByMe: boolean })[] {
  const map = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, reactedByMe: false };
    cur.count += 1;
    if (myProfileId && r.profileId === myProfileId) cur.reactedByMe = true;
    map.set(r.emoji, cur);
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }));
}

export interface PublicAttachment {
  id: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface PublicVoiceMessage {
  durationMs: number;
  waveform: number[];
  url: string;
}

export interface PublicPollOption {
  id: string;
  label: string;
  votes: number;
}

export interface PublicPoll {
  id: string;
  question: string;
  mode: PollMode;
  anonymous: boolean;
  expiresAt: string | null;
  closed: boolean;
  total: number;
  options: PublicPollOption[];
  myOptionIds: string[];
}

export interface PublicMessage {
  id: string;
  channelId: string | null;
  dmThreadId: string | null;
  author: PublicProfile;
  body: string;
  contentType: MessageContentType;
  parentId: string | null;
  threadId: string | null;
  editedAt: string | null;
  deleted: boolean;
  reactions: (ReactionSummary & { reactedByMe: boolean })[];
  attachments: PublicAttachment[];
  voice: PublicVoiceMessage | null;
  poll: PublicPoll | null;
  createdAt: string;
}

export function toPublicAttachment(a: MessageWithRelations['attachments'][number]): PublicAttachment {
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    size: a.size,
    url: mediaUrl(a.id),
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
  };
}

function toPublicPoll(poll: NonNullable<MessageWithRelations['poll']>, myProfileId?: string): PublicPoll {
  const countByOption = new Map<string, number>();
  for (const v of poll.votes) countByOption.set(v.optionId, (countByOption.get(v.optionId) ?? 0) + 1);
  const myOptionIds = myProfileId
    ? poll.votes.filter((v) => v.profileId === myProfileId).map((v) => v.optionId)
    : [];
  return {
    id: poll.id,
    question: poll.question,
    mode: poll.mode,
    anonymous: poll.anonymous,
    expiresAt: poll.expiresAt ? poll.expiresAt.toISOString() : null,
    closed: poll.expiresAt ? poll.expiresAt.getTime() < Date.now() : false,
    total: poll.votes.length,
    options: poll.options.map((o) => ({ id: o.id, label: o.label, votes: countByOption.get(o.id) ?? 0 })),
    myOptionIds,
  };
}

export function toPublicMessage(m: MessageWithRelations, myProfileId?: string): PublicMessage {
  const deleted = m.deletedAt != null;
  const voiceAttachmentId = m.voiceMessage?.attachmentId ?? null;
  return {
    id: m.id,
    channelId: m.channelId,
    dmThreadId: m.dmThreadId,
    author: toPublicProfile(m.author),
    body: deleted ? '' : m.body,
    contentType: m.contentType,
    parentId: m.parentId,
    threadId: m.threadId,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deleted,
    reactions: aggregateReactions(m.reactions ?? [], myProfileId),
    attachments: deleted
      ? []
      : (m.attachments ?? []).filter((a) => a.id !== voiceAttachmentId).map(toPublicAttachment),
    voice:
      deleted || !m.voiceMessage
        ? null
        : { durationMs: m.voiceMessage.durationMs, waveform: m.voiceMessage.waveform, url: mediaUrl(m.voiceMessage.attachmentId) },
    poll: deleted || !m.poll ? null : toPublicPoll(m.poll, myProfileId),
    createdAt: m.createdAt.toISOString(),
  };
}

export interface PublicChannel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  topic: string | null;
  visibility: ChannelVisibility;
  isArchived: boolean;
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
}

export function toPublicChannel(c: Channel, memberCount = 0): PublicChannel {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    topic: c.topic,
    visibility: c.visibility,
    isArchived: c.isArchived,
    isSystem: c.isSystem,
    memberCount,
    createdAt: c.createdAt.toISOString(),
  };
}
