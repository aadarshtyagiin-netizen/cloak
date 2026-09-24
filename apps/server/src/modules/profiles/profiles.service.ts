import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';

export interface UpdateProfileInput {
  bio?: string;
  avatarKind?: 'GENERATED' | 'UPLOADED';
  avatarSeed?: string;
  avatarUrl?: string | null;
  presenceVisible?: boolean;
}

/** Public profile lookup — returns ONLY anonymous fields (never real identity). */
export async function getPublicProfile(profileId: string): Promise<PublicProfile> {
  const profile = await prisma.anonymousProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw AppError.notFound('Profile');
  return toPublicProfile(profile);
}

/** Update the caller's own profile (self only). */
export async function updateMyProfile(
  profileId: string,
  input: UpdateProfileInput,
): Promise<PublicProfile> {
  const profile = await prisma.anonymousProfile.update({
    where: { id: profileId },
    data: {
      bio: input.bio,
      avatarKind: input.avatarKind,
      avatarSeed: input.avatarSeed,
      avatarUrl: input.avatarUrl,
      presenceVisible: input.presenceVisible,
    },
  });
  return toPublicProfile(profile);
}

export const profilesService = { getPublicProfile, updateMyProfile };
