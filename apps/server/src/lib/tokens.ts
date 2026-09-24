import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import { config } from '../config/env.js';

/**
 * The identity carried on the access token and attached to each request.
 * NOTE: it intentionally contains ONLY the public profile id + role — never the
 * internal AuthUser id or email. Even the bearer cannot decode an internal id.
 */
export interface AuthIdentity {
  profileId: string;
  role: Role;
}

const accessKey = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export async function signAccessToken(identity: AuthIdentity): Promise<string> {
  return new SignJWT({ role: identity.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(identity.profileId)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AuthIdentity> {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
  if (!payload.sub || typeof payload.role !== 'string') {
    throw new Error('Malformed access token');
  }
  return { profileId: payload.sub, role: payload.role as Role };
}
