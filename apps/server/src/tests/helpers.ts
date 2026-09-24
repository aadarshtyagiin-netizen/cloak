import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../app.js';
import { setEmailProvider } from '../modules/auth/email.js';
import type { PublicProfile } from '../common/mappers.js';

// Capture the OTP from the outgoing email instead of sending it anywhere.
let lastCode = '';
setEmailProvider({
  name: 'test',
  delivers: false,
  async send(msg) {
    const m = msg.text.match(/\b(\d{4,10})\b/);
    if (m) lastCode = m[1]!;
  },
});

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Tear down open handles so vitest exits cleanly. */
export async function cleanup(app: FastifyInstance): Promise<void> {
  await app.close();
  const { prisma } = await import('../lib/prisma.js');
  await prisma.$disconnect();
  const { redis } = await import('../lib/redis.js');
  redis.disconnect();
}

let seq = 0;
// Include the worker pid + random entropy so parallel test files running against
// the shared database can never generate the same email/slug (which would cross
// identities and cause flaky failures).
export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}_${process.pid}_${seq}_${randomBytes(4).toString('hex')}@snapdeal.com`;
}

export function uniqueSlug(prefix = 'ch'): string {
  seq += 1;
  return `${prefix}-${randomBytes(4).toString('hex')}${seq}`.toLowerCase();
}

export interface LoggedIn {
  token: string;
  profile: PublicProfile;
  email: string;
}

/** Run the full request-code → verify-code flow and return an access token. */
export async function login(app: FastifyInstance, email = uniqueEmail()): Promise<LoggedIn> {
  const rc = await app.inject({
    method: 'POST',
    url: '/v1/auth/request-code',
    payload: { email },
  });
  if (rc.statusCode !== 202) throw new Error(`request-code failed: ${rc.statusCode} ${rc.body}`);
  const { challengeId } = JSON.parse(rc.body) as { challengeId: string };

  const vc = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-code',
    payload: { challengeId, code: lastCode },
  });
  if (vc.statusCode !== 200) throw new Error(`verify-code failed: ${vc.statusCode} ${vc.body}`);
  const data = JSON.parse(vc.body) as { accessToken: string; profile: PublicProfile };
  return { token: data.accessToken, profile: data.profile, email };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Get the current OTP the fake email transport last captured. */
export function currentCode(): string {
  return lastCode;
}
