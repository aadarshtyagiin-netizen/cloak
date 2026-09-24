import { pino, type LoggerOptions } from 'pino';
import { isProd, isTest } from '../config/env.js';

/**
 * Shared pino options with privacy-first redaction: authorization headers,
 * cookies, and any field that could carry identity/secrets are censored so we
 * never leak PII or credentials into logs. Exported so Fastify can build its own
 * logger with the SAME config (keeps Fastify's default logger type).
 */
export const loggerOptions: LoggerOptions = {
  level: isTest ? 'silent' : isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.email',
      '*.emailNormalized',
      '*.employeeId',
      '*.code',
      '*.codeHash',
      '*.token',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
      '*.authUserId',
    ],
    censor: '[redacted]',
  },
  transport:
    isProd || isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
};

/** Standalone logger for non-Fastify contexts (gateway, seed, workers). */
export const logger = pino(loggerOptions);
