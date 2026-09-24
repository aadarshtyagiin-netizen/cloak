import { useEffect, useRef, useState } from 'react';
import { ApiError, authApi } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Logo, Spinner } from '../../components/ui';

type Step = 'email' | 'code';

const FRIENDLY: Record<string, string> = {
  INVALID_EMAIL: 'That does not look like a valid email address.',
  UNAUTHORIZED_DOMAIN: 'Only approved Snapdeal email addresses can sign in.',
  INVALID_CODE: 'That code is incorrect. Try again.',
  CODE_EXPIRED: 'That code expired. Request a new one.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please wait a bit and try again.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
};

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return 'Something went wrong. Please try again.';
}

export function AuthFlow(): JSX.Element {
  const setAuth = useAuth((s) => s.setAuth);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function requestCode(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.requestCode(email.trim());
      setChallengeId(res.challengeId);
      setStep('code');
      setResendIn(60);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.verifyCode(challengeId, code.trim());
      setAuth(res.accessToken, res.profile);
    } catch (err) {
      setError(messageFor(err));
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-6">
      {/* Ambient brand glow */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-10 h-72 w-72 rounded-full bg-fuchsia-600/20 blur-3xl" />

      <div className="card relative z-10 w-full max-w-md animate-fade-in p-8 shadow-2xl">
        <Logo className="text-2xl" />
        <p className="mt-2 text-sm text-ink-soft">
          A private, anonymous community for Snapdeal people. Sign in with your work email —
          inside, you are only your anonymous handle.
        </p>

        {step === 'email' ? (
          <form onSubmit={requestCode} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="email">
                Snapdeal email
              </label>
              <input
                id="email"
                type="email"
                autoFocus
                autoComplete="email"
                className="input"
                placeholder="you@snapdeal.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <button type="submit" className="btn-primary w-full" disabled={loading || !email}>
              {loading ? <Spinner /> : 'Send code'}
            </button>
            <p className="text-center text-xs text-ink-soft">
              We email you a 6-digit code. No passwords, ever.
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-8 space-y-4">
            <p className="text-sm text-ink-soft">
              Enter the 6-digit code we sent to <span className="font-medium text-ink">{email}</span>.
            </p>
            <input
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="input text-center text-2xl tracking-[0.5em]"
              placeholder="••••••"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <button type="submit" className="btn-primary w-full" disabled={loading || code.length < 4}>
              {loading ? <Spinner /> : 'Verify & enter'}
            </button>
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <button
                type="button"
                className="hover:text-ink"
                onClick={() => {
                  setStep('email');
                  setError(null);
                  setCode('');
                }}
              >
                ← Change email
              </button>
              <button
                type="button"
                disabled={resendIn > 0}
                className="hover:text-ink disabled:opacity-50"
                onClick={() => requestCode()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
