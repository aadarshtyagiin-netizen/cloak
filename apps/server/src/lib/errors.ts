/** Stable, client-facing error codes (see docs/API.md). */
export type ErrorCode =
  | 'INVALID_EMAIL'
  | 'UNAUTHORIZED_DOMAIN'
  | 'INVALID_CODE'
  | 'CODE_EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'SESSION_EXPIRED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'USERNAME_TAKEN'
  | 'INVALID_USERNAME'
  | 'REGEN_COOLDOWN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'EMAIL_SEND_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

/** An error safe to surface to clients. `details` must never carry PII. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static invalidEmail() {
    return new AppError('INVALID_EMAIL', 400, 'That does not look like a valid email address.');
  }
  static unauthorizedDomain() {
    return new AppError(
      'UNAUTHORIZED_DOMAIN',
      403,
      'Only approved Snapdeal email addresses can sign in.',
    );
  }
  static invalidCode() {
    return new AppError('INVALID_CODE', 400, 'That verification code is incorrect.');
  }
  static codeExpired() {
    return new AppError('CODE_EXPIRED', 400, 'That verification code has expired. Request a new one.');
  }
  static tooManyAttempts(retryAfterSec?: number) {
    return new AppError('TOO_MANY_ATTEMPTS', 429, 'Too many attempts. Please try again later.', {
      retryAfterSec,
    });
  }
  static sessionExpired() {
    return new AppError('SESSION_EXPIRED', 401, 'Your session has expired. Please sign in again.');
  }
  static unauthenticated() {
    return new AppError('UNAUTHENTICATED', 401, 'Authentication required.');
  }
  static forbidden(message = 'You do not have permission to do that.') {
    return new AppError('FORBIDDEN', 403, message);
  }
  static usernameTaken() {
    return new AppError('USERNAME_TAKEN', 409, 'That anonymous username is already taken.');
  }
  static invalidUsername(message = 'That username is not allowed.') {
    return new AppError('INVALID_USERNAME', 422, message);
  }
  static regenCooldown(retryAfterSec: number) {
    return new AppError(
      'REGEN_COOLDOWN',
      429,
      'You are changing identities too quickly. Try again later.',
      { retryAfterSec },
    );
  }
  static notFound(what = 'Resource') {
    return new AppError('NOT_FOUND', 404, `${what} not found.`);
  }
  static conflict(message: string) {
    return new AppError('CONFLICT', 409, message);
  }
  static emailSendFailed() {
    return new AppError(
      'EMAIL_SEND_FAILED',
      502,
      "We couldn't send your sign-in code right now. Please try again in a moment.",
    );
  }
  static serviceUnavailable(message = 'This service is temporarily unavailable.') {
    return new AppError('SERVICE_UNAVAILABLE', 503, message);
  }
}
