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

describe('anonymous identity', () => {
  it('regenerates into a different unique handle', async () => {
    const user = await login(app);
    const before = user.profile.username;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/identity/regenerate',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(200);
    const after = JSON.parse(res.body).profile.username;
    expect(after).not.toBe(before);
  });

  it('lets a user claim a custom username', async () => {
    const user = await login(app);
    const desired = `Custom_${Date.now().toString(36)}`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/identity/username',
      headers: bearer(user.token),
      payload: { username: desired },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).profile.username).toBe(desired);
  });

  it('enforces username uniqueness (409)', async () => {
    const alice = await login(app);
    const bob = await login(app);
    const name = `Shared_${Date.now().toString(36)}`;

    const first = await app.inject({
      method: 'PATCH',
      url: '/v1/identity/username',
      headers: bearer(alice.token),
      payload: { username: name },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PATCH',
      url: '/v1/identity/username',
      headers: bearer(bob.token),
      payload: { username: name },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects invalid usernames', async () => {
    const user = await login(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/identity/username',
      headers: bearer(user.token),
      payload: { username: 'no spaces!' },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});
