import type { Prisma, XPEventType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';

/**
 * Gamification: XP, levels, daily streaks, badges and achievements.
 *
 * Level curve (gentle, ever-increasing gap):
 *   levelForXp(xp) = max(1, floor(sqrt(xp / 100)) + 1)
 *   xpForLevel(l)  = (l - 1)^2 * 100      // cumulative XP needed to REACH level l
 *
 * All identity that leaves this module goes through the anonymization mapper.
 */

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1);
}

export function xpForLevel(level: number): number {
  const l = Math.max(1, level);
  return (l - 1) * (l - 1) * 100;
}

/** Default XP rewards per event type (kept here so it stays easy to tune). */
const XP_AMOUNTS: Record<XPEventType, number> = {
  MESSAGE_SENT: 2,
  REACTION_RECEIVED: 3,
  HELPFUL_MARK: 10,
  DAILY_STREAK: 15,
  POLL_CREATED: 5,
  THREAD_STARTED: 4,
  VOICE_JOIN: 5,
  ACHIEVEMENT: 25,
};

export interface XpAward {
  xp: number;
  level: number;
  leveledUp: boolean;
  gained: number;
}

/**
 * Award XP to a profile and recompute its level. Best-effort: never throws into
 * the caller's hot path (a failed reward must not fail sending a message).
 */
export async function awardXp(
  profileId: string,
  type: XPEventType,
  opts: { amount?: number; sourceType?: string; sourceId?: string } = {},
): Promise<XpAward | null> {
  const amount = opts.amount ?? XP_AMOUNTS[type];
  if (amount <= 0) return null;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.xPEvent.create({
        data: { profileId, type, amount, sourceType: opts.sourceType, sourceId: opts.sourceId },
      });
      const profile = await tx.anonymousProfile.update({
        where: { id: profileId },
        data: { xp: { increment: amount } },
        select: { xp: true, level: true },
      });
      const nextLevel = levelForXp(profile.xp);
      const leveledUp = nextLevel > profile.level;
      if (leveledUp) {
        await tx.anonymousProfile.update({ where: { id: profileId }, data: { level: nextLevel } });
      }
      return { xp: profile.xp, level: nextLevel, leveledUp, gained: amount };
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown', profileId, type }, 'awardXp failed');
    return null;
  }
}

/** Add karma (helpful reactions etc.). Best-effort. */
export async function addKarma(profileId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  try {
    await prisma.anonymousProfile.update({
      where: { id: profileId },
      data: { karma: { increment: delta } },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown', profileId }, 'addKarma failed');
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface StreakState {
  current: number;
  longest: number;
  lastActiveOn: string | null;
}

/**
 * Register activity for "today" and update the daily streak. Increments when the
 * last active day was yesterday, resets when there was a gap, no-ops when the
 * user was already active today. Awards streak XP on a fresh day.
 */
export async function touchStreak(profileId: string): Promise<StreakState | null> {
  try {
    const today = new Date();
    const todayKey = dayKey(today);
    const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000));

    const existing = await prisma.streak.findUnique({ where: { profileId } });
    const lastKey = existing?.lastActiveOn ? dayKey(existing.lastActiveOn) : null;
    if (lastKey === todayKey) {
      return { current: existing!.current, longest: existing!.longest, lastActiveOn: lastKey };
    }

    const current = lastKey === yesterdayKey ? (existing?.current ?? 0) + 1 : 1;
    const longest = Math.max(current, existing?.longest ?? 0);
    const saved = await prisma.streak.upsert({
      where: { profileId },
      update: { current, longest, lastActiveOn: new Date(`${todayKey}T00:00:00.000Z`) },
      create: { profileId, current, longest, lastActiveOn: new Date(`${todayKey}T00:00:00.000Z`) },
    });
    void awardXp(profileId, 'DAILY_STREAK', { sourceType: 'streak', sourceId: todayKey });
    return { current: saved.current, longest: saved.longest, lastActiveOn: todayKey };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown', profileId }, 'touchStreak failed');
    return null;
  }
}

export interface ProfileStats {
  messagesSent: number;
  reactionsReceived: number;
  reactionsGiven: number;
  threadsStarted: number;
  channelsJoined: number;
  bookmarks: number;
}

export interface BadgeView {
  key: string;
  name: string;
  emoji: string;
  description: string;
  awardedAt: string;
}

export interface AchievementView {
  key: string;
  name: string;
  emoji: string;
  description: string;
  threshold: number;
  progress: number;
  completed: boolean;
}

export interface ProfileOverview {
  profile: PublicProfile;
  stats: ProfileStats;
  streak: StreakState;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  rank: number;
  badges: BadgeView[];
  achievements: AchievementView[];
}

/** Full gamification overview for a profile (used by the profile screen). */
export async function getProfileOverview(profileId: string): Promise<ProfileOverview> {
  const profile = await prisma.anonymousProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw AppError.notFound('Profile');

  const [
    messagesSent,
    reactionsReceived,
    reactionsGiven,
    threadsStarted,
    channelsJoined,
    bookmarks,
    higherRanked,
    streak,
    userBadges,
    userAchievements,
  ] = await Promise.all([
    prisma.message.count({ where: { authorId: profileId, deletedAt: null } }),
    prisma.reaction.count({ where: { message: { authorId: profileId } } }),
    prisma.reaction.count({ where: { profileId } }),
    prisma.thread.count({ where: { rootMessage: { authorId: profileId } } }),
    prisma.channelMember.count({ where: { profileId } }),
    prisma.bookmark.count({ where: { profileId } }),
    prisma.anonymousProfile.count({ where: { xp: { gt: profile.xp } } }),
    prisma.streak.findUnique({ where: { profileId } }),
    prisma.userBadge.findMany({ where: { profileId }, include: { badge: true }, orderBy: { awardedAt: 'desc' } }),
    prisma.userAchievement.findMany({ where: { profileId }, include: { achievement: true } }),
  ]);

  const level = levelForXp(profile.xp);
  const xpForCurrentLevel = xpForLevel(level);
  const xpForNextLevel = xpForLevel(level + 1);

  return {
    profile: toPublicProfile(profile),
    stats: { messagesSent, reactionsReceived, reactionsGiven, threadsStarted, channelsJoined, bookmarks },
    streak: {
      current: streak?.current ?? 0,
      longest: streak?.longest ?? 0,
      lastActiveOn: streak?.lastActiveOn ? dayKey(streak.lastActiveOn) : null,
    },
    level,
    xp: profile.xp,
    xpIntoLevel: profile.xp - xpForCurrentLevel,
    xpForCurrentLevel,
    xpForNextLevel,
    rank: higherRanked + 1,
    badges: userBadges.map((ub) => ({
      key: ub.badge.key,
      name: ub.badge.name,
      emoji: ub.badge.emoji,
      description: ub.badge.description,
      awardedAt: ub.awardedAt.toISOString(),
    })),
    achievements: userAchievements.map((ua) => ({
      key: ua.achievement.key,
      name: ua.achievement.name,
      emoji: ua.achievement.emoji,
      description: ua.achievement.description,
      threshold: ua.achievement.threshold,
      progress: ua.progress,
      completed: ua.completedAt != null,
    })),
  };
}

export type LeaderboardPeriod = 'all' | 'week';

export interface LeaderboardEntry {
  rank: number;
  profile: PublicProfile;
  xp: number;
}

/** Anonymous leaderboard. `all` uses lifetime XP; `week` sums the last 7 days. */
export async function getLeaderboard(
  period: LeaderboardPeriod,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  if (period === 'all') {
    const profiles = await prisma.anonymousProfile.findMany({
      orderBy: [{ xp: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
    return profiles.map((p, i) => ({ rank: i + 1, profile: toPublicProfile(p), xp: p.xp }));
  }

  const since = new Date(Date.now() - 7 * 86_400_000);
  const grouped = await prisma.xPEvent.groupBy({
    by: ['profileId'],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: limit,
  });
  const ids = grouped.map((g) => g.profileId);
  const profiles = await prisma.anonymousProfile.findMany({ where: { id: { in: ids } } });
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return grouped
    .filter((g) => byId.has(g.profileId))
    .map((g, i) => ({
      rank: i + 1,
      profile: toPublicProfile(byId.get(g.profileId)!),
      xp: g._sum.amount ?? 0,
    }));
}

export interface BadgeCatalogEntry {
  key: string;
  name: string;
  emoji: string;
  description: string;
}

export async function listBadgeCatalog(): Promise<BadgeCatalogEntry[]> {
  const badges = await prisma.badge.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  return badges.map((b) => ({ key: b.key, name: b.name, emoji: b.emoji, description: b.description }));
}

export const gamificationService = {
  levelForXp,
  xpForLevel,
  awardXp,
  addKarma,
  touchStreak,
  getProfileOverview,
  getLeaderboard,
  listBadgeCatalog,
};

export type { XPEventType, Prisma };
