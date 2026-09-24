import type { Notification, NotificationLevel, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';
import { getRealtime } from '../realtime/emit.js';

export interface NotificationView {
  id: string;
  type: NotificationType;
  actor: PublicProfile | null;
  channelId: string | null;
  messageId: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

type NotificationWithActor = Notification & {
  actor: Parameters<typeof toPublicProfile>[0] | null;
};

function toView(n: NotificationWithActor): NotificationView {
  return {
    id: n.id,
    type: n.type,
    actor: n.actor ? toPublicProfile(n.actor) : null,
    channelId: n.channelId,
    messageId: n.messageId,
    payload: n.payload,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

interface CreateInput {
  recipientId: string;
  type: NotificationType;
  actorProfileId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  payload?: Prisma.InputJsonValue;
}

/** Create a notification and push it to the recipient in real time (best-effort). */
async function create(input: CreateInput): Promise<void> {
  // Never notify yourself.
  if (input.actorProfileId && input.actorProfileId === input.recipientId) return;
  try {
    const row = await prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        actorProfileId: input.actorProfileId ?? null,
        channelId: input.channelId ?? null,
        messageId: input.messageId ?? null,
        payload: input.payload ?? {},
      },
      include: { actor: true },
    });
    getRealtime().emitNotification(input.recipientId, toView(row));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'notification create failed');
  }
}

/** Extract @Username mentions (word chars, 3–24). Case-insensitive, de-duped. */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /@([A-Za-z0-9_]{3,24})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

export interface ChannelMessageContext {
  messageId: string;
  channelId: string;
  authorId: string;
  body: string;
}

/**
 * Fan out notifications for a freshly-sent channel message: @mentions, plus a
 * thread reply notice to the root author. Best-effort; never blocks the send.
 */
export async function notifyChannelMessage(
  ctx: ChannelMessageContext,
  opts: { rootAuthorId?: string | null; mentionAll?: boolean } = {},
): Promise<void> {
  const mentions = parseMentions(ctx.body);
  const hasEveryone = /@(everyone|channel)\b/i.test(ctx.body);

  const targetIds = new Set<string>();

  if (mentions.length > 0) {
    const profiles = await prisma.anonymousProfile.findMany({
      where: { usernameLower: { in: mentions } },
      select: { id: true },
    });
    for (const p of profiles) targetIds.add(p.id);
  }

  if (hasEveryone) {
    const members = await prisma.channelMember.findMany({
      where: { channelId: ctx.channelId },
      select: { profileId: true },
    });
    for (const m of members) targetIds.add(m.profileId);
  }

  targetIds.delete(ctx.authorId);
  for (const recipientId of targetIds) {
    if ((await effectiveLevel(recipientId, ctx.channelId)) === 'NOTHING') continue;
    void create({
      recipientId,
      type: 'MENTION',
      actorProfileId: ctx.authorId,
      channelId: ctx.channelId,
      messageId: ctx.messageId,
      payload: { snippet: ctx.body.slice(0, 140) },
    });
  }

  if (opts.rootAuthorId && opts.rootAuthorId !== ctx.authorId && !targetIds.has(opts.rootAuthorId)) {
    if ((await effectiveLevel(opts.rootAuthorId, ctx.channelId)) !== 'NOTHING') {
      void create({
        recipientId: opts.rootAuthorId,
        type: 'THREAD_REPLY',
        actorProfileId: ctx.authorId,
        channelId: ctx.channelId,
        messageId: ctx.messageId,
        payload: { snippet: ctx.body.slice(0, 140) },
      });
    }
  }
}

export function notifyReaction(input: {
  recipientId: string;
  actorProfileId: string;
  channelId: string | null;
  messageId: string;
  emoji: string;
}): void {
  void create({
    recipientId: input.recipientId,
    type: 'REACTION',
    actorProfileId: input.actorProfileId,
    channelId: input.channelId,
    messageId: input.messageId,
    payload: { emoji: input.emoji },
  });
}

export function notifyDm(input: {
  recipientId: string;
  actorProfileId: string;
  threadId: string;
  messageId: string;
  snippet: string;
}): void {
  void create({
    recipientId: input.recipientId,
    type: 'DM',
    actorProfileId: input.actorProfileId,
    messageId: input.messageId,
    payload: { threadId: input.threadId, snippet: input.snippet.slice(0, 140) },
  });
}

export async function listNotifications(
  profileId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientId: profileId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 30, 1), 100),
    include: { actor: true },
  });
  return rows.map(toView);
}

export async function unreadCount(profileId: string): Promise<number> {
  return prisma.notification.count({ where: { recipientId: profileId, readAt: null } });
}

export async function markRead(profileId: string, ids?: string[]): Promise<void> {
  await prisma.notification.updateMany({
    where: { recipientId: profileId, readAt: null, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

// ─────────────────────────── Preferences (All / Mentions / Important / Nothing) ───────────────────────────

export interface PreferencesView {
  global: NotificationLevel;
  channels: { channelId: string; level: NotificationLevel }[];
}

export async function getPreferences(profileId: string): Promise<PreferencesView> {
  const rows = await prisma.notificationPreference.findMany({ where: { profileId } });
  const global = rows.find((r) => r.channelId === null)?.level ?? 'ALL';
  const channels = rows
    .filter((r): r is typeof r & { channelId: string } => r.channelId !== null)
    .map((r) => ({ channelId: r.channelId, level: r.level }));
  return { global, channels };
}

/** Upsert a preference. channelId=null sets the global default. */
export async function setPreference(
  profileId: string,
  channelId: string | null,
  level: NotificationLevel,
): Promise<void> {
  // Nullable columns don't participate in Postgres unique constraints reliably,
  // so do a manual find-then-write rather than upsert on (profileId, null).
  const existing = await prisma.notificationPreference.findFirst({ where: { profileId, channelId } });
  if (existing) {
    await prisma.notificationPreference.update({ where: { id: existing.id }, data: { level } });
  } else {
    await prisma.notificationPreference.create({ data: { profileId, channelId, level } });
  }
}

/** Effective level for a recipient in a channel (channel pref overrides global). */
async function effectiveLevel(profileId: string, channelId: string | null): Promise<NotificationLevel> {
  const [chanPref, globalPref] = await Promise.all([
    channelId ? prisma.notificationPreference.findFirst({ where: { profileId, channelId } }) : Promise.resolve(null),
    prisma.notificationPreference.findFirst({ where: { profileId, channelId: null } }),
  ]);
  return chanPref?.level ?? globalPref?.level ?? 'ALL';
}

export const notificationsService = {
  parseMentions,
  notifyChannelMessage,
  notifyReaction,
  notifyDm,
  listNotifications,
  unreadCount,
  markRead,
  getPreferences,
  setPreference,
};
