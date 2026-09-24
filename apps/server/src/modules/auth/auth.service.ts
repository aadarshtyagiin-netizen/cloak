import type { AnonymousProfile } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { config, allowedEmailDomains, isAdminEmail } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  generateNumericCode,
  hashSecret,
  randomToken,
  sha256,
  verifySecret,
} from '../../lib/crypto.js';
import { signAccessToken } from '../../lib/tokens.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';
import { provisionAnonymousProfile } from '../identity/identity.service.js';
import { buildVerificationEmail, getEmailProvider } from './email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate format + Snapdeal domain restriction; throws precise error codes. */
export function assertAllowedEmail(rawEmail: string): { email: string; domain: string } {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw AppError.invalidEmail();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (!allowedEmailDomains.includes(domain)) throw AppError.unauthorizedDomain();
  return { email, domain };
}

function deriveDeviceLabel(userAgent?: string): string {
  if (!userAgent) return 'Unknown device';
  const os = /Windows/i.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(userAgent)
      ? 'macOS'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(userAgent)
          ? 'iOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Chrome\//i.test(userAgent)
      ? 'Chrome'
      : /Firefox\//i.test(userAgent)
        ? 'Firefox'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}

export interface RequestCodeResult {
  challengeId: string;
  expiresInSec: number;
}

/**
 * Step 1 of login: validate the email + domain, rate-limit resends, generate a
 * hashed OTP, and email it. Does not reveal whether an account already exists.
 */
export async function requestCode(rawEmail: string): Promise<RequestCodeResult> {
  const { email } = assertAllowedEmail(rawEmail);

  const last = await prisma.emailVerification.findFirst({
    where: { emailNormalized: email },
    orderBy: { createdAt: 'desc' },
  });
  if (last && !last.consumedAt) {
    const sinceSec = (Date.now() - last.createdAt.getTime()) / 1000;
    if (sinceSec < config.OTP_RESEND_COOLDOWN_SEC) {
      throw AppError.tooManyAttempts(Math.ceil(config.OTP_RESEND_COOLDOWN_SEC - sinceSec));
    }
  }

  const code = generateNumericCode(config.OTP_LENGTH);
  const codeHash = await hashSecret(code);
  const expiresAt = new Date(Date.now() + config.OTP_TTL_SEC * 1000);
  const record = await prisma.emailVerification.create({
    data: { emailNormalized: email, codeHash, expiresAt },
  });

  const mail = buildVerificationEmail(code, Math.round(config.OTP_TTL_SEC / 60));
  const provider = getEmailProvider();
  try {
    await provider.send({ to: rawEmail.trim(), ...mail });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown', transport: provider.name },
      'failed to send verification email',
    );
    // On a real transport (smtp/resend) a delivery failure means the user will
    // never get the code, so surface it instead of silently "succeeding".
    // The console transport is dev-only and intentionally non-fatal.
    if (provider.delivers) throw AppError.emailSendFailed();
  }
  // Dev convenience: print the code to the SERVER log only (never the API/HTTP response).
  if (config.OTP_DEV_LOG) {
    logger.info({ challengeId: record.id, code }, '🔑 DEV OTP (server console only)');
  }

  return { challengeId: record.id, expiresInSec: config.OTP_TTL_SEC };
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  profile: PublicProfile;
}

interface SessionContext {
  ip?: string;
  userAgent?: string;
}

async function createSession(
  authUserId: string,
  ctx: SessionContext,
): Promise<{ refreshToken: string }> {
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SEC * 1000);
  await prisma.session.create({
    data: {
      authUserId,
      tokenHash: sha256(refreshToken),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      deviceLabel: deriveDeviceLabel(ctx.userAgent),
      expiresAt,
    },
  });
  return { refreshToken };
}

function assertActive(status: string): void {
  if (status !== 'ACTIVE') {
    throw AppError.forbidden('This account is not permitted to sign in.');
  }
}

/**
 * Step 2 of login: verify the OTP with brute-force protection, then provision
 * (or look up) the AuthUser + AnonymousProfile atomically and issue tokens.
 */
export async function verifyCode(
  challengeId: string,
  code: string,
  ctx: SessionContext,
): Promise<AuthResult> {
  const record = await prisma.emailVerification.findUnique({ where: { id: challengeId } });
  if (!record || record.consumedAt) throw AppError.invalidCode();
  if (record.expiresAt.getTime() < Date.now()) throw AppError.codeExpired();
  if (record.attempts >= config.OTP_MAX_ATTEMPTS) throw AppError.tooManyAttempts();

  const valid = await verifySecret(code.trim(), record.codeHash);
  if (!valid) {
    const attempts = record.attempts + 1;
    const lockedOut = attempts >= config.OTP_MAX_ATTEMPTS;
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { attempts, consumedAt: lockedOut ? new Date() : null },
    });
    throw lockedOut ? AppError.tooManyAttempts() : AppError.invalidCode();
  }

  const email = record.emailNormalized;
  const { authUser, profile } = await prisma.$transaction(async (tx) => {
    await tx.emailVerification.updateMany({
      where: { emailNormalized: email, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const existing = await tx.authUser.findUnique({
      where: { emailNormalized: email },
      include: { profile: true },
    });

    let user = existing;
    let anon: AnonymousProfile;
    const shouldBeAdmin = isAdminEmail(email);
    if (!user) {
      user = await tx.authUser.create({
        data: { email, emailNormalized: email, role: shouldBeAdmin ? 'ADMIN' : 'USER' },
        include: { profile: true },
      });
      anon = await provisionAnonymousProfile(tx, user.id);
    } else {
      assertActive(user.status);
      // Bootstrap: promote a configured email even if the account predates it.
      if (shouldBeAdmin && user.role !== 'ADMIN') {
        user = await tx.authUser.update({
          where: { id: user.id },
          data: { role: 'ADMIN' },
          include: { profile: true },
        });
      }
      anon = user.profile ?? (await provisionAnonymousProfile(tx, user.id));
    }

    await tx.authUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { authUser: user, profile: anon };
  });

  assertActive(authUser.status);

  const { refreshToken } = await createSession(authUser.id, ctx);
  const accessToken = await signAccessToken({ profileId: profile.id, role: authUser.role });

  return {
    accessToken,
    refreshToken,
    expiresIn: config.ACCESS_TOKEN_TTL_SEC,
    profile: toPublicProfile(profile),
  };
}

/**
 * Rotate the refresh token. Detects reuse of an already-rotated token and
 * revokes the whole session family (theft response).
 */
export async function refresh(refreshToken: string, ctx: SessionContext): Promise<AuthResult> {
  const tokenHash = sha256(refreshToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { authUser: { include: { profile: true } } },
  });
  if (!session) throw AppError.sessionExpired();

  if (session.revokedAt) {
    // Reuse of a rotated/revoked token → revoke every active session for the user.
    await prisma.session.updateMany({
      where: { authUserId: session.authUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw AppError.sessionExpired();
  }
  if (session.expiresAt.getTime() < Date.now()) throw AppError.sessionExpired();
  assertActive(session.authUser.status);
  const profile = session.authUser.profile;
  if (!profile) throw AppError.sessionExpired();

  const newToken = randomToken(32);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SEC * 1000);
  await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        authUserId: session.authUserId,
        tokenHash: sha256(newToken),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        deviceLabel: session.deviceLabel ?? deriveDeviceLabel(ctx.userAgent),
        expiresAt,
      },
    });
    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: created.id, lastActiveAt: new Date() },
    });
  });

  const accessToken = await signAccessToken({ profileId: profile.id, role: session.authUser.role });
  return {
    accessToken,
    refreshToken: newToken,
    expiresIn: config.ACCESS_TOKEN_TTL_SEC,
    profile: toPublicProfile(profile),
  };
}

export async function logout(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(profileId: string): Promise<{ profile: PublicProfile }> {
  const profile = await prisma.anonymousProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw AppError.notFound('Profile');
  return { profile: toPublicProfile(profile) };
}

export interface SessionView {
  id: string;
  deviceLabel: string | null;
  lastActiveAt: string;
  createdAt: string;
  current: boolean;
}

export async function listSessions(
  profileId: string,
  currentRefreshToken?: string,
): Promise<SessionView[]> {
  const profile = await prisma.anonymousProfile.findUnique({
    where: { id: profileId },
    select: { authUserId: true },
  });
  if (!profile) throw AppError.notFound('Profile');

  const sessions = await prisma.session.findMany({
    where: { authUserId: profile.authUserId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
  });
  const currentHash = currentRefreshToken ? sha256(currentRefreshToken) : null;

  return sessions.map((s) => ({
    id: s.id,
    deviceLabel: s.deviceLabel,
    lastActiveAt: s.lastActiveAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    current: currentHash != null && s.tokenHash === currentHash,
  }));
}

export async function revokeSession(profileId: string, sessionId: string): Promise<void> {
  const profile = await prisma.anonymousProfile.findUnique({
    where: { id: profileId },
    select: { authUserId: true },
  });
  if (!profile) throw AppError.notFound('Profile');

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.authUserId !== profile.authUserId) throw AppError.notFound('Session');

  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export const authService = {
  requestCode,
  verifyCode,
  refresh,
  logout,
  getMe,
  listSessions,
  revokeSession,
  assertAllowedEmail,
  normalizeEmail,
};
