import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, cleanup, uniqueEmail, currentCode } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await cleanup(app);
});

describe('auth flow', () => {
  it('rejects a non-Snapdeal domain with UNAUTHORIZED_DOMAIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-code',
      payload: { email: 'someone@gmail.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED_DOMAIN');
  });

  it('rejects a malformed email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-code',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_EMAIL');
  });

  it('issues an anonymous identity on first login', async () => {
    const email = uniqueEmail('firstlogin');
    const rc = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-code',
      payload: { email },
    });
    expect(rc.statusCode).toBe(202);
    const { challengeId } = JSON.parse(rc.body);

    const vc = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-code',
      payload: { challengeId, code: currentCode() },
    });
    expect(vc.statusCode).toBe(200);
    const body = JSON.parse(vc.body);
    expect(body.accessToken).toBeTruthy();
    expect(body.profile.username).toMatch(/\w+/);
    // Sets an httpOnly refresh cookie.
    expect(String(vc.headers['set-cookie'])).toContain('cloak_rt=');
  });

  it('rejects a wrong code, then locks out after too many attempts', async () => {
    const email = uniqueEmail('lockout');
    const rc = await app.inject({
      method: 'POST',
      url: '/v1/auth/request-code',
      payload: { email },
    });
    const { challengeId } = JSON.parse(rc.body);

    const codes = ['000000', '111111', '222222', '333333'];
    for (const code of codes) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify-code',
        payload: { challengeId, code },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_CODE');
    }
    // 5th wrong attempt trips the lockout.
    const locked = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-code',
      payload: { challengeId, code: '444444' },
    });
    expect(locked.statusCode).toBe(429);
    expect(JSON.parse(locked.body).error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('requires authentication for /me', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
