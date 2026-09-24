import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gamificationApi } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Avatar, ProgressBar, Skeleton, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';

export function HomePage(): JSX.Element {
  const profile = useAuth((s) => s.profile);
  const { channels, openSidebar } = useShell();
  const overview = useQuery({ queryKey: ['overview', 'me'], queryFn: gamificationApi.meOverview });

  const o = overview.data;
  const intoLevel = o ? o.xpIntoLevel : 0;
  const levelSpan = o ? Math.max(1, o.xpForNextLevel - o.xpForCurrentLevel) : 1;

  const popular = [...channels].sort((a, b) => b.memberCount - a.memberCount).slice(0, 6);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
          ☰ Menu
        </button>

        {/* Hero */}
        <section className="card relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            {profile ? (
              <Avatar seed={profile.avatarSeed} username={profile.username} size="xl" presence="ONLINE" url={profile.avatarUrl} />
            ) : (
              <Skeleton className="h-[72px] w-[72px] rounded-full" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-soft">Welcome back, you're anonymous as</p>
              <h1 className="truncate text-2xl font-extrabold">{profile?.username ?? '…'}</h1>
              <div className="mt-3 max-w-md">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
                  <span>Level {o?.level ?? profile?.level ?? 1}</span>
                  <span>{o ? `${intoLevel}/${levelSpan} XP` : '…'}</span>
                </div>
                <ProgressBar value={intoLevel} max={levelSpan} />
              </div>
            </div>
            <div className="flex gap-3 sm:flex-col">
              <HeroStat icon="🔥" label="Streak" value={o ? `${o.streak.current}d` : '—'} />
              <HeroStat icon="🏅" label="Rank" value={o ? `#${o.rank}` : '—'} />
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon="💬" label="Messages" value={o?.stats.messagesSent} loading={overview.isLoading} />
          <StatCard icon="❤️" label="Reactions" value={o?.stats.reactionsReceived} loading={overview.isLoading} />
          <StatCard icon="#️⃣" label="Channels" value={o?.stats.channelsJoined} loading={overview.isLoading} />
          <StatCard icon="🔖" label="Bookmarks" value={o?.stats.bookmarks} loading={overview.isLoading} />
        </section>

        {/* Quick actions */}
        <section className="mt-6 flex flex-wrap gap-3">
          <Link to="/me" className="btn-subtle">👤 My profile</Link>
          <Link to="/dm" className="btn-subtle">✉️ Messages</Link>
          <Link to="/leaderboard" className="btn-subtle">🏆 Leaderboard</Link>
          <Link to="/bookmarks" className="btn-subtle">🔖 Bookmarks</Link>
        </section>

        {/* Popular channels */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Jump back in</h2>
          {popular.length === 0 ? (
            <p className="text-sm text-ink-soft">No channels yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {popular.map((c) => (
                <Link
                  key={c.id}
                  to={`/c/${c.id}`}
                  className="card group p-4 transition hover:border-brand-500 hover:shadow-lg"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg text-ink-soft">#</span>
                    <span className="truncate font-semibold group-hover:text-brand-300">{c.name}</span>
                    {c.isSystem ? <span title="System">📌</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                    {c.description ?? c.topic ?? 'Jump into the conversation.'}
                  </p>
                  <p className="mt-3 text-xs text-ink-soft">👥 {c.memberCount} members</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="card flex items-center gap-4 p-5">
            <span className="text-3xl">🕶️</span>
            <div className="flex-1">
              <p className="font-semibold">Anonymous to the community, accountable to the platform.</p>
              <p className="text-sm text-ink-soft">
                No one here can see your real name or email — only {profile?.username ?? 'your handle'}.
                Change your identity anytime from your profile.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function HeroStat({ icon, label, value }: { icon: string; label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
      <span className="text-lg">{icon}</span>
      <div>
        <div className="text-sm font-bold leading-tight">{value}</div>
        <div className="text-[11px] text-ink-soft">{label}</div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: string;
  label: string;
  value?: number;
  loading?: boolean;
}): JSX.Element {
  return (
    <div className={cx('card p-4')}>
      <div className="text-xl">{icon}</div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-12" />
      ) : (
        <div className="mt-1 text-2xl font-extrabold tabular-nums">{value ?? 0}</div>
      )}
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  );
}
