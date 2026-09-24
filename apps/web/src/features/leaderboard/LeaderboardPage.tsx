import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gamificationApi } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Avatar, Spinner, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardPage(): JSX.Element {
  const { openSidebar } = useShell();
  const meId = useAuth((s) => s.profile?.id);
  const [period, setPeriod] = useState<'all' | 'week'>('week');
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => gamificationApi.leaderboard(period),
  });
  const entries = data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
          ☰ Menu
        </button>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-extrabold">🏆 Leaderboard</h1>
          <div className="flex rounded-xl border border-line bg-surface-2 p-0.5 text-sm">
            <TabButton active={period === 'week'} onClick={() => setPeriod('week')}>This week</TabButton>
            <TabButton active={period === 'all'} onClick={() => setPeriod('all')}>All time</TabButton>
          </div>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Ranked by XP earned. Identities are anonymous — no leaderboard position maps to a real person.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-10 text-ink-soft"><Spinner /></div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-ink-soft">No activity in this period yet.</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.profile.id}>
                <Link
                  to={`/u/${e.profile.id}`}
                  className={cx(
                    'flex items-center gap-3 rounded-xl border p-3 transition hover:bg-surface-2',
                    e.profile.id === meId ? 'border-brand-500/60 bg-brand-600/10' : 'border-transparent',
                  )}
                >
                  <span className="w-8 text-center text-lg font-bold tabular-nums">
                    {e.rank <= 3 ? MEDALS[e.rank - 1] : e.rank}
                  </span>
                  <Avatar seed={e.profile.avatarSeed} username={e.profile.username} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {e.profile.username}
                      {e.profile.id === meId ? <span className="ml-2 text-xs text-brand-300">you</span> : null}
                    </div>
                    <div className="text-xs text-ink-soft">Level {e.profile.level}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums">{e.xp.toLocaleString()}</div>
                    <div className="text-[11px] text-ink-soft">XP</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cx('rounded-lg px-3 py-1 transition', active ? 'bg-brand-600 text-white' : 'text-ink-soft hover:text-ink')}
    >
      {children}
    </button>
  );
}
