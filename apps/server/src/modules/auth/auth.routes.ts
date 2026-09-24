import type { FastifyInstance, FastifyReply } from 'fastify';
import { config, isProd } from '../../config/env.js';
import { currentIdentity } from '../../plugins/auth.js';
import { requestCodeSchema, verifyCodeSchema } from './auth.schemas.js';
import { authService } from './auth.service.js';

const AUTH_RL = {
  rateLimit: { max: config.RATE_LIMIT_AUTH_PER_15MIN, timeWindow: '15 minutes' },
};

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    // SameSite=None requires Secure; also force Secure in production.
    secure: isProd || config.COOKIE_SAMESITE === 'none',
    sameSite: config.COOKIE_SAMESITE,
    path: '/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL_SEC,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Step 1 — request an OTP for a Snapdeal email.
  app.post('/request-code', { config: AUTH_RL }, async (req, reply) => {
    const { email } = requestCodeSchema.parse(req.body);
    const result = await authService.requestCode(email);
    return reply.code(202).send(result);
  });

  // Step 2 — verify the OTP; issues access token + refresh cookie.
  app.post('/verify-code', { config: AUTH_RL }, async (req, reply) => {
    const { challengeId, code } = verifyCodeSchema.parse(req.body);
    const result = await authService.verifyCode(challengeId, code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(reply, result.refreshToken);
    return reply.code(200).send({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      profile: result.profile,
    });
  });

  // Rotate access token using the refresh cookie.
  app.post('/refresh', async (req, reply) => {
    const token = req.cookies[config.REFRESH_COOKIE_NAME];
    if (!token) return reply.code(401).send({ error: { code: 'SESSION_EXPIRED', message: 'No session.' } });
    const result = await authService.refresh(token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(reply, result.refreshToken);
    return reply.code(200).send({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      profile: result.profile,
    });
  });

  // Log out — revoke the current session and clear the cookie.
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[config.REFRESH_COOKIE_NAME];
    await authService.logout(token);
    reply.clearCookie(config.REFRESH_COOKIE_NAME, {
      path: '/v1/auth',
      secure: isProd || config.COOKIE_SAMESITE === 'none',
      sameSite: config.COOKIE_SAMESITE,
    });
    return reply.code(204).send();
  });

  // Current anonymous profile.
  app.get('/me', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    return authService.getMe(profileId);
  });

  // Device/session management.
  app.get('/sessions', { preHandler: app.authGuard }, async (req) => {
    const { profileId } = currentIdentity(req);
    const token = req.cookies[config.REFRESH_COOKIE_NAME];
    const data = await authService.listSessions(profileId, token);
    return { data };
  });

  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: app.authGuard },
    async (req, reply) => {
      const { profileId } = currentIdentity(req);
      await authService.revokeSession(profileId, req.params.id);
      return reply.code(204).send();
    },
  );
}
