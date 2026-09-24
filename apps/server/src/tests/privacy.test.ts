import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, cleanup, login, bearer } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await cleanup(app);
});

/**
 * THE critical guarantee: no ordinary API response may reveal the underlying
 * Snapdeal email / real identity. We drive representative endpoints and assert
 * the serialized JSON contains none of the forbidden markers.
 */
describe('identity privacy', () => {
  it('never leaks email / internal id across user-facing endpoints', async () => {
    const alice = await login(app);
    const bob = await login(app);

    const localPart = alice.email.split('@')[0]!;
    const forbidden = [
      alice.email,
      localPart,
      'authUserId',
      'emailNormalized',
      'employeeId',
      'codeHash',
      'tokenHash',
    ];

    const channelsRes = await app.inject({ method: 'GET', url: '/v1/channels', headers: bearer(alice.token) });
    const channels = JSON.parse(channelsRes.body).data as { id: string; slug: string }[];
    const general = channels.find((c) => c.slug === 'general') ?? channels[0];

    // Post a message so it appears in listings.
    await app.inject({
      method: 'POST',
      url: `/v1/channels/${general.id}/messages`,
      headers: bearer(alice.token),
      payload: { body: 'privacy probe message' },
    });

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(alice.token) }),
      app.inject({ method: 'GET', url: '/v1/channels', headers: bearer(alice.token) }),
      app.inject({ method: 'GET', url: `/v1/channels/${general.id}/members`, headers: bearer(alice.token) }),
      app.inject({ method: 'GET', url: `/v1/channels/${general.id}/messages`, headers: bearer(alice.token) }),
      app.inject({ method: 'GET', url: `/v1/profiles/${alice.profile.id}`, headers: bearer(alice.token) }),
      // Alice viewing Bob's profile must not reveal Bob's identity either.
      app.inject({ method: 'GET', url: `/v1/profiles/${bob.profile.id}`, headers: bearer(alice.token) }),
    ]);

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      for (const marker of forbidden) {
        expect(res.body).not.toContain(marker);
      }
    }
  });

  it('public profile exposes only anonymous fields', async () => {
    const alice = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${alice.profile.id}`,
      headers: bearer(alice.token),
    });
    const { profile } = JSON.parse(res.body);
    expect(Object.keys(profile).sort()).toEqual(
      ['avatarKind', 'avatarSeed', 'avatarUrl', 'bio', 'id', 'joinedAt', 'karma', 'level', 'presence', 'username', 'xp'].sort(),
    );
  });
});
