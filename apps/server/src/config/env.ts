import 'dotenv/config';
import { z } from 'zod';

/** Parse "true"/"1" (case-insensitive) into a boolean. */
const boolFlag = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v) => v.toLowerCase() === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  // Public base URL of THIS API (scheme+host, no trailing slash). Needed so media
  // links are ABSOLUTE when the web app is on a different origin (e.g. Cloudflare
  // Pages web + Render API). Empty falls back to Render's injected
  // RENDER_EXTERNAL_URL, then to a relative URL (dev/same-origin via Vite proxy).
  API_PUBLIC_URL: z.string().default(''),

  // Domain restriction
  ALLOWED_EMAIL_DOMAINS: z.string().default('snapdeal.com'),
  ALLOW_TEST_DOMAIN: boolFlag('false'),

  // Comma-separated emails that are granted the ADMIN role on login. This is how
  // you bootstrap moderators/admins in a fresh (no-seed) production database.
  ADMIN_EMAILS: z.string().default(''),

  // Infra
  DATABASE_URL: z.string().min(1),
  // Optional: set to enable the Redis-backed Socket.IO adapter + presence store
  // (needed only for multi-instance scaling). Empty = in-memory (single node).
  REDIS_URL: z.string().default(''),

  // Tokens
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2_592_000),
  REFRESH_COOKIE_NAME: z.string().default('cloak_rt'),
  // Refresh-cookie SameSite policy. Use 'none' when the web app and API are on
  // different origins in production (e.g. Cloudflare Pages web + separate API);
  // 'strict'/'lax' are best when they share an origin. 'none' implies Secure.
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  // OTP
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive().default(60),
  OTP_DEV_LOG: boolFlag('false'),

  // Email. `console` logs only (dev/test); `smtp` uses any real SMTP relay
  // (Mailhog in dev, SES/Workspace/etc. in prod); `resend` uses the Resend
  // HTTPS API; `brevo` uses the Brevo HTTPS API (recommended in production —
  // rides port 443, so it works on hosts that block outbound SMTP like Render).
  EMAIL_TRANSPORT: z.enum(['smtp', 'console', 'resend', 'brevo']).default('console'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  // Brevo transactional-email API key (`xkeysib-…`). Used when EMAIL_TRANSPORT=brevo.
  BREVO_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Cloak <no-reply@snapdeal.com>'),
  EMAIL_REPLY_TO: z.string().default(''),

  // Identity generation rules
  IDENTITY_REGEN_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(3600),
  IDENTITY_REGEN_MAX_PER_DAY: z.coerce.number().int().positive().default(5),

  // Rate limiting
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_PER_15MIN: z.coerce.number().int().positive().default(10),

  // Media storage (local-disk driver). Files are streamed through the API with
  // signed capability URLs. MEDIA_DIR is resolved relative to the server cwd.
  MEDIA_DIR: z.string().default('.uploads'),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400), // 25 MB

  // Storage driver: 'local' disk (dev / single node) or 's3' (any S3-compatible
  // object store — Backblaze B2, Cloudflare R2, AWS S3, MinIO — via S3_ENDPOINT).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_FORCE_PATH_STYLE: boolFlag('false'),

  // LiveKit SFU (voice/video rooms). LIVEKIT_URL is what the browser connects to.
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message; never print secret values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = parsed.data;
export type AppConfig = typeof config;

/** Normalized list of allowed email domains (lowercased). */
export const allowedEmailDomains: string[] = (() => {
  const base = config.ALLOWED_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (config.ALLOW_TEST_DOMAIN && !base.includes('example.com')) base.push('example.com');
  return base;
})();

export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

/**
 * Absolute public base URL of this API (no trailing slash), used to build media
 * links that load cross-origin. Falls back to Render's injected RENDER_EXTERNAL_URL;
 * empty means same-origin relative URLs (dev via the Vite proxy).
 */
export const apiPublicUrl: string = (config.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(
  /\/+$/,
  '',
);

/** Emails (lowercased) that should receive the ADMIN role on login. */
export const adminEmails: string[] = config.ADMIN_EMAILS.split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}
