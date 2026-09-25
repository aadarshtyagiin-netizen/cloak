import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dice5, Sun, Moon, LogOut } from 'lucide-react';
import { authApi, identityApi, ApiError } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useUI } from '../../store/ui';
import { Avatar, cx } from '../../components/ui';

/** Bottom-of-sidebar card: your anonymous identity + quick actions. */
export function SelfCard(): JSX.Element | null {
  const profile = useAuth((s) => s.profile);
  const setProfile = useAuth((s) => s.setProfile);
  const clear = useAuth((s) => s.clear);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const pushToast = useUI((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  async function regenerate(): Promise<void> {
    setBusy(true);
    try {
      const res = await identityApi.regenerate();
      setProfile(res.profile);
      pushToast('success', `You are now ${res.profile.username}`);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not regenerate identity.');
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface-4 p-2">
      <Link to="/me" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 transition hover:bg-surface-3" title="View your profile">
        <Avatar seed={profile.avatarSeed} username={profile.username} size="md" presence="ONLINE" url={profile.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{profile.username}</div>
          <div className="text-xs text-ink-soft">Level {profile.level} · {profile.xp} XP</div>
        </div>
      </Link>
      <div className="flex items-center gap-0.5">
        <IconButton title="Generate a new identity" onClick={regenerate} disabled={busy}>
          <Dice5 className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </IconButton>
        <IconButton title="Log out" onClick={logout}>
          <LogOut className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-3 hover:text-ink',
        disabled && 'opacity-50',
      )}
    >
      {children}
    </button>
  );
}
