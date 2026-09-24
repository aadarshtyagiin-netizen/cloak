import { Prisma } from '@prisma/client';
import type { AnonymousProfile } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';
import { randomUsername } from './identity.generator.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';

/** Custom usernames: 3–24 chars, letters/numbers/underscore. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const MAX_GENERATION_TRIES = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a unique anonymous profile for a freshly-created AuthUser. Runs inside
 * the login transaction so account + identity are provisioned atomically.
 * Retries on the rare username collision, then falls back to extra entropy.
 */
export async function provisionAnonymousProfile(
  tx: Prisma.TransactionClient,
  authUserId: string,
): Promise<AnonymousProfile> {
  for (let i = 0; i < MAX_GENERATION_TRIES; i += 1) {
    const { username, avatarSeed } = randomUsername();
    const usernameLower = username.toLowerCase();
    const taken = await tx.anonymousProfile.findUnique({ where: { usernameLower } });
    if (!taken) {
      return tx.anonymousProfile.create({
        data: { authUserId, username, usernameLower, avatarSeed },
      });
    }
  }
  // Extremely unlikely fallback: append random suffix.
  const base = randomUsername().username;
  const suffix = randomToken(4).replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || '00';
  const username = `${base}${suffix}`;
  return tx.anonymousProfile.create({
    data: {
      authUserId,
      username,
      usernameLower: username.toLowerCase(),
      avatarSeed: randomToken(6),
    },
  });
}

/** Regenerate a brand-new anonymous identity, honoring cooldown + daily cap. */
export async function regenerateIdentity(profileId: string): Promise<PublicProfile> {
  const profile = await prisma.anonymousProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw AppError.notFound('Profile');

  const now = Date.now();
  if (profile.lastRegenAt) {
    const sinceSec = (now - profile.lastRegenAt.getTime()) / 1000;
    if (sinceSec < config.IDENTITY_REGEN_COOLDOWN_SEC) {
      throw AppError.regenCooldown(Math.ceil(config.IDENTITY_REGEN_COOLDOWN_SEC - sinceSec));
    }
  }

  // Daily counter resets if the last regeneration was more than 24h ago.
  const withinDay = profile.lastRegenAt && now - profile.lastRegenAt.getTime() < DAY_MS;
  const regenCount = withinDay ? profile.regenCount : 0;
  if (regenCount >= config.IDENTITY_REGEN_MAX_PER_DAY) {
    throw AppError.regenCooldown(config.IDENTITY_REGEN_COOLDOWN_SEC);
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (let i = 0; i < MAX_GENERATION_TRIES; i += 1) {
      const { username, avatarSeed } = randomUsername();
      const usernameLower = username.toLowerCase();
      const taken = await tx.anonymousProfile.findUnique({ where: { usernameLower } });
      if (!taken) {
        return tx.anonymousProfile.update({
          where: { id: profileId },
          data: {
            username,
            usernameLower,
            avatarSeed,
            avatarKind: 'GENERATED',
            regenCount: regenCount + 1,
            lastRegenAt: new Date(),
          },
        });
      }
    }
    throw AppError.conflict('Could not generate a unique identity. Please try again.');
  });

  return toPublicProfile(updated);
}

/** Set a custom (unique) anonymous username. */
export async function setUsername(profileId: string, desired: string): Promise<PublicProfile> {
  const username = desired.trim();
  if (!USERNAME_RE.test(username)) {
    throw AppError.invalidUsername('Usernames must be 3–24 letters, numbers, or underscores.');
  }
  const usernameLower = username.toLowerCase();

  const existing = await prisma.anonymousProfile.findUnique({ where: { usernameLower } });
  if (existing && existing.id !== profileId) throw AppError.usernameTaken();

  try {
    const updated = await prisma.anonymousProfile.update({
      where: { id: profileId },
      data: { username, usernameLower },
    });
    return toPublicProfile(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.usernameTaken();
    }
    throw err;
  }
}

export const identityService = { provisionAnonymousProfile, regenerateIdentity, setUsername };
