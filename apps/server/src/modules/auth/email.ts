import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { config, isProd } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  /** Short transport name for logging. */
  readonly name: string;
  /** Whether this transport actually delivers to real inboxes (console does not). */
  readonly delivers: boolean;
  send(msg: EmailMessage): Promise<void>;
  /** Optional startup check; resolves true when the transport looks usable. */
  verify?(): Promise<boolean>;
}

/** Dev/test transport: logs a notice (never the code) instead of sending. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly delivers = false;

  async send(msg: EmailMessage): Promise<void> {
    logger.info(
      { to: msg.to, subject: msg.subject },
      'email dispatched (console transport — nothing was actually sent)',
    );
  }
}

/**
 * SMTP transport via nodemailer. Works with any real SMTP relay — Google
 * Workspace, Amazon SES, Mailgun, Postmark, Resend SMTP, or Mailhog in dev.
 * Implicit TLS is used on port 465; STARTTLS on 587 and others.
 */
class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly delivers = true;
  private readonly transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: config.EMAIL_FROM,
      to: msg.to,
      replyTo: config.EMAIL_REPLY_TO || undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', host: config.SMTP_HOST, port: config.SMTP_PORT },
        'SMTP transport could not be verified',
      );
      return false;
    }
  }
}

/**
 * Resend transport (HTTPS API). The recommended production transport: it is
 * resilient to blocked SMTP ports and gives real deliverability + logs. Set
 * EMAIL_TRANSPORT=resend and RESEND_API_KEY, and use a verified sender domain
 * (or Resend's onboarding@resend.dev while testing).
 */
class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly delivers = true;
  private client: Resend | null = null;

  // Lazily construct the client so an empty key doesn't crash the process at
  // import time — it surfaces as a clear send-time error instead.
  private getClient(): Resend {
    if (!config.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set');
    }
    if (!this.client) this.client = new Resend(config.RESEND_API_KEY);
    return this.client;
  }

  async send(msg: EmailMessage): Promise<void> {
    const { error } = await this.getClient().emails.send({
      from: config.EMAIL_FROM,
      to: msg.to,
      replyTo: config.EMAIL_REPLY_TO || undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? msg.text,
    });
    if (error) throw new Error(`Resend error: ${error.name} — ${error.message}`);
  }

  async verify(): Promise<boolean> {
    if (!config.RESEND_API_KEY) {
      logger.warn('EMAIL_TRANSPORT=resend but RESEND_API_KEY is empty — codes will not be delivered');
      return false;
    }
    return true;
  }
}

/** Parse `"Name <email@host>"` (or a bare address) into Brevo's sender shape. */
function parseEmailFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: from.trim() };
}

/**
 * Brevo (Sendinblue) transactional email over their HTTPS API. Unlike SMTP,
 * this rides port 443, so it works on hosts that block outbound SMTP ports —
 * e.g. Render's free tier blocks 25/465/587. Set EMAIL_TRANSPORT=brevo and
 * BREVO_API_KEY (an `xkeysib-…` key from Brevo → SMTP & API → API Keys). The
 * sender is taken from EMAIL_FROM and must be a Verified sender in Brevo.
 */
class BrevoApiEmailProvider implements EmailProvider {
  readonly name = 'brevo-api';
  readonly delivers = true;

  async send(msg: EmailMessage): Promise<void> {
    if (!config.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set');
    const sender = parseEmailFrom(config.EMAIL_FROM);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': config.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: msg.to }],
        replyTo: config.EMAIL_REPLY_TO ? { email: config.EMAIL_REPLY_TO } : undefined,
        subject: msg.subject,
        textContent: msg.text,
        htmlContent: msg.html ?? msg.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Brevo API error ${res.status}: ${detail.slice(0, 300)}`);
    }
  }

  async verify(): Promise<boolean> {
    if (!config.BREVO_API_KEY) {
      logger.warn('EMAIL_TRANSPORT=brevo but BREVO_API_KEY is empty — codes will not be delivered');
      return false;
    }
    return true;
  }
}

function createProvider(): EmailProvider {
  switch (config.EMAIL_TRANSPORT) {
    case 'brevo':
      return new BrevoApiEmailProvider();
    case 'resend':
      return new ResendEmailProvider();
    case 'smtp':
      return new SmtpEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}

export const defaultEmailProvider: EmailProvider = createProvider();

// Injectable provider so tests (and future DI) can swap the transport.
let currentProvider: EmailProvider = defaultEmailProvider;
export function getEmailProvider(): EmailProvider {
  return currentProvider;
}
export function setEmailProvider(provider: EmailProvider): void {
  currentProvider = provider;
}

/**
 * Best-effort startup check: logs the active transport and warns loudly about
 * misconfiguration (unverified SMTP, missing Resend key, or console-in-prod).
 * Never throws — a misconfigured mailer must not stop the API from booting.
 */
export async function verifyEmailTransport(): Promise<void> {
  const provider = currentProvider;
  logger.info(
    { transport: provider.name, delivers: provider.delivers, from: config.EMAIL_FROM },
    'email transport configured',
  );
  if (!provider.delivers && isProd) {
    logger.warn(
      'EMAIL_TRANSPORT=console in production — sign-in codes will NOT be delivered. Set EMAIL_TRANSPORT=resend or smtp.',
    );
  }
  if (provider.verify) {
    const ok = await provider.verify();
    if (!ok) {
      logger.warn({ transport: provider.name }, 'email transport verification failed — sign-in codes may not be delivered');
    }
  }
}

/** Build the verification email body. The code is only ever in the email body. */
export function buildVerificationEmail(code: string, ttlMinutes: number): Omit<EmailMessage, 'to'> {
  const subject = `Your Cloak sign-in code: ${code}`;
  const text = `Your Cloak verification code is ${code}. It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`;
  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto">
    <h2 style="margin:0 0 8px">🕶️ Cloak</h2>
    <p style="color:#555">Use this code to sign in. It expires in ${ttlMinutes} minutes.</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${code}</div>
    <p style="color:#999;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
  return { subject, text, html };
}
