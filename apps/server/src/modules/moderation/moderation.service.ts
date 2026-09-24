import type { ReportTargetType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetProfileId?: string;
  targetMessageId?: string;
  targetChannelId?: string;
  reason: string;
  details?: string;
}

/**
 * File a report. The report references only anonymous profile ids / message ids;
 * a moderator resolves it later (and any identity unmask is separately audited).
 */
export async function createReport(reporterProfileId: string, input: CreateReportInput): Promise<{ id: string }> {
  const reason = input.reason.trim();
  if (!reason) throw AppError.conflict('A reason is required.');

  if (input.targetType === 'MESSAGE' && !input.targetMessageId) throw AppError.conflict('Missing message.');
  if (input.targetType === 'USER' && !input.targetProfileId) throw AppError.conflict('Missing user.');
  if (input.targetType === 'CHANNEL' && !input.targetChannelId) throw AppError.conflict('Missing channel.');

  const report = await prisma.report.create({
    data: {
      reporterProfileId,
      targetType: input.targetType,
      targetProfileId: input.targetProfileId ?? null,
      targetMessageId: input.targetMessageId ?? null,
      targetChannelId: input.targetChannelId ?? null,
      reason,
      details: input.details?.trim() || null,
    },
  });
  return { id: report.id };
}

// ---- Blocking (hide + prevent interaction) ----

export async function toggleBlock(profileId: string, targetProfileId: string): Promise<{ blocked: boolean }> {
  if (targetProfileId === profileId) throw AppError.conflict('You cannot block yourself.');
  const target = await prisma.anonymousProfile.findUnique({ where: { id: targetProfileId }, select: { id: true } });
  if (!target) throw AppError.notFound('Profile');

  const existing = await prisma.block.findUnique({
    where: { blockerProfileId_blockedProfileId: { blockerProfileId: profileId, blockedProfileId: targetProfileId } },
  });
  if (existing) {
    await prisma.block.delete({ where: { id: existing.id } });
    return { blocked: false };
  }
  await prisma.block.create({ data: { blockerProfileId: profileId, blockedProfileId: targetProfileId } });
  return { blocked: true };
}

export async function listBlocks(profileId: string): Promise<PublicProfile[]> {
  const rows = await prisma.block.findMany({
    where: { blockerProfileId: profileId },
    include: { blocked: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((b) => toPublicProfile(b.blocked));
}

// ---- Muting (hide messages, still allows their existence) ----

export async function toggleMute(profileId: string, targetProfileId: string): Promise<{ muted: boolean }> {
  if (targetProfileId === profileId) throw AppError.conflict('You cannot mute yourself.');
  const target = await prisma.anonymousProfile.findUnique({ where: { id: targetProfileId }, select: { id: true } });
  if (!target) throw AppError.notFound('Profile');

  const existing = await prisma.mute.findUnique({
    where: { muterProfileId_mutedProfileId: { muterProfileId: profileId, mutedProfileId: targetProfileId } },
  });
  if (existing) {
    await prisma.mute.delete({ where: { id: existing.id } });
    return { muted: false };
  }
  await prisma.mute.create({ data: { muterProfileId: profileId, mutedProfileId: targetProfileId } });
  return { muted: true };
}

export async function listMutes(profileId: string): Promise<PublicProfile[]> {
  const rows = await prisma.mute.findMany({
    where: { muterProfileId: profileId },
    include: { muted: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((m) => toPublicProfile(m.muted));
}

export const moderationService = { createReport, toggleBlock, listBlocks, toggleMute, listMutes };
