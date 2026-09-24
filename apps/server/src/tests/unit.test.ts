import { describe, it, expect } from 'vitest';
import type { AnonymousProfile } from '@prisma/client';
import { randomUsername } from '../modules/identity/identity.generator.js';
import { assertAllowedEmail } from '../modules/auth/auth.service.js';
import { toPublicProfile } from '../common/mappers.js';
import { decodeCursor, encodeCursor } from '../common/pagination.js';
import { signAccessToken, verifyAccessToken } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

describe('identity generator', () => {
  it('produces <Adjective><Noun><NN> handles', () => {
    for (let i = 0; i < 100; i += 1) {
      const { username, avatarSeed } = randomUsername();
      expect(username).toMatch(/^[A-Za-z]+\d{2}$/);
      expect(avatarSeed.length).toBeGreaterThan(0);
    }
  });

  it('has enough entropy to rarely collide', () => {
    const set = new Set<string>();
    for (let i = 0; i < 500; i += 1) set.add(randomUsername().username);
    // 40*40*90 = 144k combos; 500 draws should almost never fully collide.
    expect(set.size).toBeGreaterThan(450);
  });
});

describe('Snapdeal email restriction', () => {
  it('accepts an @snapdeal.com address', () => {
    expect(assertAllowedEmail('Aadarsh@Snapdeal.com')).toEqual({
      email: 'aadarsh@snapdeal.com',
      domain: 'snapdeal.com',
    });
  });

  it('rejects a non-Snapdeal domain', () => {
    try {
      assertAllowedEmail('someone@gmail.com');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('UNAUTHORIZED_DOMAIN');
    }
  });

  it('rejects a malformed email', () => {
    try {
      assertAllowedEmail('not-an-email');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_EMAIL');
    }
  });
});

describe('anonymization mapper', () => {
  const row: AnonymousProfile = {
    id: 'prof_1',
    authUserId: 'auth_secret_1',
    username: 'BlueFox42',
    usernameLower: 'bluefox42',
    avatarKind: 'GENERATED',
    avatarSeed: 'seed',
    avatarUrl: null,
    bio: 'hi',
    karma: 10,
    xp: 100,
    level: 2,
    presenceVisible: true,
    presenceStatus: 'ONLINE',
    regenCount: 0,
    lastRegenAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('never exposes internal identity fields', () => {
    const dto = toPublicProfile(row);
    const json = JSON.stringify(dto);
    expect(json).not.toContain('authUserId');
    expect(json).not.toContain('auth_secret_1');
    expect(Object.keys(dto)).not.toContain('authUserId');
    expect(dto.username).toBe('BlueFox42');
  });

  it('hides presence when the user made it invisible', () => {
    const dto = toPublicProfile({ ...row, presenceVisible: false });
    expect(dto.presence).toBe('OFFLINE');
  });
});

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const c = { createdAt: new Date().toISOString(), id: 'msg_123' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('rejects garbage cursors', () => {
    expect(decodeCursor('not-base64-!!!')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('access tokens', () => {
  it('signs and verifies a profile identity (no internal id)', async () => {
    const token = await signAccessToken({ profileId: 'prof_1', role: 'USER' });
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    expect(payload.sub).toBe('prof_1');
    expect(payload).not.toHaveProperty('authUserId');
    expect(payload).not.toHaveProperty('email');

    const identity = await verifyAccessToken(token);
    expect(identity).toEqual({ profileId: 'prof_1', role: 'USER' });
  });

  it('rejects a tampered token', async () => {
    await expect(verifyAccessToken('a.b.c')).rejects.toBeTruthy();
  });
});
