import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, dmApi, gamificationApi, identityApi, moderationApi } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useUI } from '../../store/ui';
import { Avatar, EmptyState, ProgressBar, Skeleton, cx } from '../../components/ui';
import { ReportDialog } from '../chat/MessageList';
import type { AchievementView, BadgeView } from '../../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ProfilePage(): JSX.Element {
  const { profileId } = useParams();
  const me = useAuth((s) => s.profile);
  const setProfile = useAuth((s) => s.setProfile);
  const pushToast = useUI((s) => s.pushToast);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const targetId = profileId ?? me?.id ?? '';
  const isSelf = targetId === me?.id;
  const [reporting, setReporting] = useState(false);

  const overview = useQuery({
    queryKey: ['overview', targetId],
    queryFn: () => gamificationApi.profileOverview(targetId),
    enabled: !!targetId,
  });

  const regen = useMutation({
    mutationFn: () => identityApi.regenerate(),
    onSuccess: (res) => {
      setProfile(res.profile);
      pushToast('success', `You are now ${res.profile.username}`);
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not regenerate.'),
  });

  const block = useMutation({
    mutationFn: () => moderationApi.toggleBlock(targetId),
    onSuccess: (res) => pushToast('info', res.blocked ? 'User blocked' : 'User unblocked'),
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not block.'),
  });

  const openDm = useMutation({
    mutationFn: () => dmApi.open(targetId),
    onSuccess: (res) => navigate(`/dm/${res.thread.id}`),
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not open DM.'),
  });

  if (overview.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!overview.data) {
    return <EmptyState icon="🕳️" title="Profile not found" />;
  }

  const o = overview.data;
  const p = o.profile;
  const levelSpan = Math.max(1, o.xpForNextLevel - o.xpForCurrentLevel);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        {/* Header card */}
        <section className="card relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-fuchsia-600/20 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar seed={p.avatarSeed} username={p.username} size="xl" presence={p.presence} url={p.avatarUrl} />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-extrabold">{p.username}</h1>
              <p className="text-sm text-ink-soft">Joined {formatDate(p.joinedAt)} · Rank #{o.rank}</p>
              <p className="mt-2 max-w-lg text-sm text-ink">{p.bio ?? (isSelf ? 'Add a bio in Settings.' : 'No bio yet.')}</p>

              <div className="mt-4 max-w-md">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
                  <span>Level {o.level}</span>
                  <span>{o.xpIntoLevel}/{levelSpan} XP · {o.xp} total</span>
                </div>
                <ProgressBar value={o.xpIntoLevel} max={levelSpan} />
              </div>
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap gap-2">
            {isSelf ? (
              <>
                <button className="btn-subtle" onClick={() => regen.mutate()} disabled={regen.isPending}>
                  🎲 New identity
                </button>
                <button className="btn-ghost" onClick={() => navigate('/settings')}>⚙️ Settings</button>
              </>
            ) : (
              <>
                <button className="btn-primary" onClick={() => openDm.mutate()} disabled={openDm.isPending}>
                  ✉️ Message
                </button>
                <button className="btn-ghost" onClick={() => block.mutate()} disabled={block.isPending}>
                  🚫 Block
                </button>
                <button className="btn-ghost" onClick={() => setReporting(true)}>🚩 Report</button>
              </>
            )}
          </div>
        </section>

        {/* Quick stats */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Karma" value={p.karma} icon="✨" />
          <Stat label="Current streak" value={`${o.streak.current}d`} icon="🔥" />
          <Stat label="Longest streak" value={`${o.streak.longest}d`} icon="📅" />
          <Stat label="Messages" value={o.stats.messagesSent} icon="💬" />
          <Stat label="Reactions received" value={o.stats.reactionsReceived} icon="❤️" />
          <Stat label="Threads started" value={o.stats.threadsStarted} icon="🧵" />
        </section>

        {/* Badges */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Badges</h2>
          {o.badges.length === 0 ? (
            <p className="text-sm text-ink-soft">No badges yet — keep participating to earn them.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {o.badges.map((b) => (
                <BadgeCard key={b.key} badge={b} />
              ))}
            </div>
          )}
        </section>

        {/* Achievements */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Achievements</h2>
          {o.achievements.length === 0 ? (
            <p className="text-sm text-ink-soft">No achievement progress yet.</p>
          ) : (
            <div className="space-y-3">
              {o.achievements.map((a) => (
                <AchievementRow key={a.key} achievement={a} />
              ))}
            </div>
          )}
        </section>
      </div>

      <ReportDialog open={reporting} onClose={() => setReporting(false)} targetProfileId={targetId} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: string }): JSX.Element {
  return (
    <div className="card p-4">
      <div className="text-lg">{icon}</div>
      <div className="mt-1 text-xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  );
}

function BadgeCard({ badge }: { badge: BadgeView }): JSX.Element {
  return (
    <div className="card flex items-center gap-3 p-3" title={badge.description}>
      <span className="text-2xl">{badge.emoji}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{badge.name}</div>
        <div className="truncate text-xs text-ink-soft">{badge.description}</div>
      </div>
    </div>
  );
}

function AchievementRow({ achievement }: { achievement: AchievementView }): JSX.Element {
  return (
    <div className={cx('card p-3', achievement.completed && 'border-brand-500/50')}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{achievement.emoji}</span>
        <span className="flex-1 text-sm font-semibold">{achievement.name}</span>
        <span className="text-xs text-ink-soft tabular-nums">
          {Math.min(achievement.progress, achievement.threshold)}/{achievement.threshold}
          {achievement.completed ? ' ✓' : ''}
        </span>
      </div>
      <p className="mb-2 mt-1 text-xs text-ink-soft">{achievement.description}</p>
      <ProgressBar value={achievement.progress} max={achievement.threshold} />
    </div>
  );
}
