import type { AccountStatus, ReportStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';
import { getRealtime } from '../realtime/emit.js';

/** Resolve the (internal) AuthUser id behind a public profile — never exposed. */
async function authUserIdForProfile(profileId: string): Promise<string> {
  const p = await prisma.anonymousProfile.findUnique({ where: { id: profileId }, select: { authUserId: true } });
  if (!p) throw AppError.notFound('Profile');
  return p.authUserId;
}

// ─────────────────────────── Stats ───────────────────────────

export interface AdminStats {
  users: number;
  messages: number;
  channels: number;
  openReports: number;
  messages24h: number;
  dau: number;
  activeVoiceRooms: number;
  activeVideoRooms: number;
}

export async function getStats(): Promise<AdminStats> {
  const since = new Date(Date.now() - 86_400_000);
  const [users, messages, channels, openReports, messages24h, activeAuthors, activeVoiceRooms, activeVideoRooms] =
    await Promise.all([
      prisma.authUser.count(),
      prisma.message.count({ where: { deletedAt: null } }),
      prisma.channel.count(),
      prisma.report.count({ where: { status: 'OPEN' } }),
      prisma.message.count({ where: { createdAt: { gte: since } } }),
      prisma.message.findMany({ where: { createdAt: { gte: since } }, distinct: ['authorId'], select: { authorId: true } }),
      prisma.voiceRoom.count({ where: { isActive: true } }),
      prisma.videoRoom.count({ where: { isActive: true } }),
    ]);
  return { users, messages, channels, openReports, messages24h, dau: activeAuthors.length, activeVoiceRooms, activeVideoRooms };
}

// ─────────────────────────── Reports ───────────────────────────

export interface ReportView {
  id: string;
  targetType: string;
  reporter: PublicProfile | null;
  targetProfile: PublicProfile | null;
  targetMessageId: string | null;
  messageSnippet: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
}

export async function listReports(status?: ReportStatus): Promise<ReportView[]> {
  const reports = await prisma.report.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { reporter: true, targetProfile: true },
  });
  const messageIds = reports.map((r) => r.targetMessageId).filter((x): x is string => !!x);
  const messages = messageIds.length
    ? await prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, body: true } })
    : [];
  const snippetById = new Map(messages.map((m) => [m.id, m.body.slice(0, 200)]));
  return reports.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    reporter: r.reporter ? toPublicProfile(r.reporter) : null,
    targetProfile: r.targetProfile ? toPublicProfile(r.targetProfile) : null,
    targetMessageId: r.targetMessageId,
    messageSnippet: r.targetMessageId ? snippetById.get(r.targetMessageId) ?? null : null,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function resolveReport(reportId: string, status: ReportStatus): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status, resolvedAt: status === 'RESOLVED' || status === 'DISMISSED' ? new Date() : null },
  });
}

// ─────────────────────────── Moderation actions ───────────────────────────

export type UserAction = 'SUSPEND' | 'BAN' | 'UNBAN';

export async function actOnUser(
  actorProfileId: string,
  targetProfileId: string,
  action: UserAction,
  reason: string,
): Promise<void> {
  const [moderatorAuthUserId, targetAuthUserId] = await Promise.all([
    authUserIdForProfile(actorProfileId),
    authUserIdForProfile(targetProfileId),
  ]);
  const statusMap: Record<UserAction, AccountStatus> = { SUSPEND: 'SUSPENDED', BAN: 'BANNED', UNBAN: 'ACTIVE' };
  await prisma.$transaction([
    prisma.authUser.update({ where: { id: targetAuthUserId }, data: { status: statusMap[action] } }),
    prisma.moderationAction.create({
      data: {
        moderatorAuthUserId,
        action: action === 'UNBAN' ? 'UNBAN' : action === 'BAN' ? 'BAN' : 'SUSPEND',
        targetAuthUserId,
        targetProfileId,
        reason: reason.trim() || `${action} by moderator`,
      },
    }),
  ]);
}

export async function deleteMessageAsMod(actorProfileId: string, messageId: string, reason: string): Promise<void> {
  const moderatorAuthUserId = await authUserIdForProfile(actorProfileId);
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw AppError.notFound('Message');
  await prisma.$transaction([
    prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedByProfileId: actorProfileId } }),
    prisma.moderationAction.create({
      data: { moderatorAuthUserId, action: 'DELETE_MESSAGE', targetMessageId: messageId, targetProfileId: message.authorId, reason: reason.trim() || 'Removed by moderator' },
    }),
  ]);
  if (message.channelId) getRealtime().emitMessageDeleted(message.channelId, messageId);
}

// ─────────────────────────── Audited identity unmask (ADMIN only) ───────────────────────────

export interface UnmaskResult {
  username: string;
  email: string;
  employeeId: string | null;
  role: string;
  status: string;
  joinedAt: string;
  lastLoginAt: string | null;
}

/**
 * THE sanctioned identity unmask. Returns the real account behind an anonymous
 * profile. Every call writes an AuditLog row + a ModerationAction. Admin only.
 */
export async function unmaskIdentity(
  actorProfileId: string,
  targetProfileId: string,
  ip?: string,
): Promise<UnmaskResult> {
  const moderatorAuthUserId = await authUserIdForProfile(actorProfileId);
  const target = await prisma.anonymousProfile.findUnique({
    where: { id: targetProfileId },
    select: { authUserId: true, username: true },
  });
  if (!target) throw AppError.notFound('Profile');
  const account = await prisma.authUser.findUnique({
    where: { id: target.authUserId },
    select: { email: true, employeeId: true, role: true, status: true, createdAt: true, lastLoginAt: true },
  });
  if (!account) throw AppError.notFound('Account');

  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        actorAuthUserId: moderatorAuthUserId,
        action: 'UNMASK_IDENTITY',
        subjectType: 'AnonymousProfile',
        subjectId: targetProfileId,
        metadata: { username: target.username },
        ip: ip ?? null,
      },
    }),
    prisma.moderationAction.create({
      data: {
        moderatorAuthUserId,
        action: 'UNMASK_IDENTITY',
        targetAuthUserId: target.authUserId,
        targetProfileId,
        reason: 'Identity unmask (admin, audited)',
      },
    }),
  ]);

  return {
    username: target.username,
    email: account.email,
    employeeId: account.employeeId,
    role: account.role,
    status: account.status,
    joinedAt: account.createdAt.toISOString(),
    lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
  };
}

export async function listAuditLog(): Promise<{ id: string; action: string; subjectType: string; subjectId: string; createdAt: string }[]> {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((a) => ({ id: a.id, action: a.action, subjectType: a.subjectType, subjectId: a.subjectId, createdAt: a.createdAt.toISOString() }));
}

// ─────────────────────────── Config (badges, reactions) ───────────────────────────

export async function listBadges() {
  return prisma.badge.findMany({ orderBy: { createdAt: 'asc' } });
}
export async function createBadge(input: { key: string; name: string; emoji: string; description: string }) {
  return prisma.badge.create({ data: { ...input, criteria: {} } });
}
export async function setBadgeActive(id: string, isActive: boolean) {
  await prisma.badge.update({ where: { id }, data: { isActive } });
}

export async function listReactionPresets() {
  return prisma.reactionPreset.findMany({ orderBy: { position: 'asc' } });
}
export async function createReactionPreset(input: { key: string; emoji: string; label: string }) {
  const count = await prisma.reactionPreset.count();
  return prisma.reactionPreset.create({ data: { ...input, position: count } });
}
export async function setReactionPresetActive(id: string, isActive: boolean) {
  await prisma.reactionPreset.update({ where: { id }, data: { isActive } });
}

export async function moderatedConfessions() {
  const rows = await prisma.confession.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100 });
  return rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString() }));
}
export async function moderateConfession(actorProfileId: string, id: string, approve: boolean): Promise<void> {
  const moderatorAuthUserId = await authUserIdForProfile(actorProfileId);
  await prisma.confession.update({
    where: { id },
    data: { status: approve ? 'APPROVED' : 'REJECTED', publishedAt: approve ? new Date() : null, moderatedByAuthUserId: moderatorAuthUserId },
  });
}

export const adminService = {
  getStats,
  listReports,
  resolveReport,
  actOnUser,
  deleteMessageAsMod,
  unmaskIdentity,
  listAuditLog,
  listBadges,
  createBadge,
  setBadgeActive,
  listReactionPresets,
  createReactionPreset,
  setReactionPresetActive,
  moderatedConfessions,
  moderateConfession,
};
