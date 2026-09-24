import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../lib/api';
import { useNotifications } from '../../store/notifications';
import { Avatar, EmptyState, Spinner, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';
import type { NotificationView } from '../../types';

function describe(n: NotificationView): string {
  switch (n.type) {
    case 'MENTION':
      return 'mentioned you';
    case 'THREAD_REPLY':
      return 'replied in a thread';
    case 'REACTION':
      return `reacted ${n.payload?.emoji ?? ''}`.trim();
    case 'DM':
      return 'sent you a message';
    default:
      return 'sent you a notification';
  }
}

function linkFor(n: NotificationView): string | null {
  if (n.type === 'DM' && n.payload?.threadId) return `/dm/${n.payload.threadId}`;
  if (n.channelId) return `/c/${n.channelId}`;
  return null;
}

export function NotificationsPage(): JSX.Element {
  const { openSidebar } = useShell();
  const qc = useQueryClient();
  const reset = useNotifications((s) => s.reset);
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list() });
  const items = data?.data ?? [];

  // Opening the page marks everything read.
  useEffect(() => {
    notificationsApi
      .markRead()
      .then(() => {
        reset();
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
          ☰ Menu
        </button>
        <h1 className="mb-4 text-xl font-extrabold">🔔 Notifications</h1>

        {isLoading ? (
          <div className="flex justify-center py-10 text-ink-soft"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon="🔔" title="You're all caught up" hint="Mentions, replies, reactions and DMs will show up here." />
        ) : (
          <ul className="space-y-1">
            {items.map((n) => {
              const to = linkFor(n);
              const body = (
                <div
                  className={cx(
                    'flex items-center gap-3 rounded-xl border border-transparent p-3',
                    !n.readAt && 'bg-brand-600/5',
                  )}
                >
                  {n.actor ? (
                    <Avatar seed={n.actor.avatarSeed} username={n.actor.username} size="sm" />
                  ) : (
                    <span className="text-xl">🔔</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold">{n.actor?.username ?? 'Cloak'}</span>{' '}
                      <span className="text-ink-soft">{describe(n)}</span>
                    </p>
                    {n.payload?.snippet ? (
                      <p className="truncate text-xs text-ink-soft">“{n.payload.snippet}”</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-soft">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </span>
                </div>
              );
              return (
                <li key={n.id}>{to ? <Link to={to} className="block hover:bg-surface-2 rounded-xl">{body}</Link> : body}</li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
