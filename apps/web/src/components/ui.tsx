import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { VenetianMask, CircleCheck, CircleAlert, Info } from 'lucide-react';
import { useUI } from '../store/ui';
import type { Presence } from '../types';

export const cx = clsx;

/** Deterministic hue from a string so each anonymous user gets a stable color. */
function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

const SIZES = { sm: 28, md: 36, lg: 48, xl: 72 } as const;

export function Avatar({
  seed,
  username,
  size = 'md',
  presence,
  url,
}: {
  seed: string;
  username: string;
  size?: keyof typeof SIZES;
  presence?: Presence;
  url?: string | null;
}): JSX.Element {
  const px = SIZES[size];
  const hue = hueFromSeed(seed || username);
  const initials = username.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: px, height: px }}>
      {url ? (
        <img
          src={url}
          alt={username}
          className="h-full w-full rounded-full object-cover"
          style={{ width: px, height: px }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-bold text-white select-none"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
            fontSize: px * 0.36,
          }}
          aria-hidden
        >
          {initials}
        </div>
      )}
      {presence ? (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface-2">
          <PresenceDot status={presence} />
        </span>
      ) : null}
    </div>
  );
}

const PRESENCE_COLOR: Record<Presence, string> = {
  ONLINE: 'bg-emerald-500',
  AWAY: 'bg-amber-400',
  DND: 'bg-rose-500',
  OFFLINE: 'bg-zinc-500',
  INVISIBLE: 'bg-zinc-500',
};

export function PresenceDot({ status }: { status: Presence }): JSX.Element {
  return <span className={cx('block h-3 w-3 rounded-full', PRESENCE_COLOR[status])} />;
}

export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cx('inline-flex items-center gap-2 font-extrabold tracking-tight', className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-600/30">
        <VenetianMask className="h-4 w-4" />
      </span>
      <span>Cloak</span>
    </span>
  );
}

/** Global toast host. */
export function Toaster(): JSX.Element {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              'pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border bg-surface-2 px-4 py-3 text-sm shadow-pop-lg animate-slide-up',
              t.kind === 'error'
                ? 'border-danger/40'
                : t.kind === 'success'
                  ? 'border-positive/40'
                  : 'border-line',
            )}
          >
            <Icon
              className={cx(
                'h-4 w-4 shrink-0',
                t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-positive' : 'text-brand-400',
              )}
            />
            <span className="text-left text-ink">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}



/** A small icon button used across chrome (sidebar, headers, cards). */
export function IconButton({
  title,
  onClick,
  label,
  disabled,
  active,
}: {
  title: string;
  onClick: () => void;
  label: ReactNode;
  disabled?: boolean;
  active?: boolean;
}): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-lg text-base transition hover:bg-surface-3',
        active && 'bg-brand-600/15 text-brand-300',
        disabled && 'opacity-50',
      )}
    >
      {label}
    </button>
  );
}

/** Centered empty-state block for lists/screens with no content yet. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-ink-soft">
      <span className="text-4xl">{icon}</span>
      <p className="text-lg font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-sm">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Thin XP/progress bar. `value`/`max` are clamped to [0, max]. */
export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Rounded skeleton block for loading states. */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cx('animate-pulse rounded-lg bg-surface-3', className)} />;
}

/** Lightweight modal (backdrop click / Escape to close). */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden />
      <div className="card relative z-10 w-full max-w-md animate-pop-in p-6 shadow-pop-lg">
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
