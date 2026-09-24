import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dmApi } from '../../lib/api';
import { Avatar, EmptyState, Spinner, cx } from '../../components/ui';
import { useShell } from '../chat/AppShell';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function DmListPage(): JSX.Element {
  const { openSidebar } = useShell();
  const { data, isLoading } = useQuery({ queryKey: ['dm-threads'], queryFn: dmApi.list });
  const threads = data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
          ☰ Menu
        </button>
        <h1 className="mb-4 text-xl font-extrabold">Direct Messages</h1>

        {isLoading ? (
          <div className="flex justify-center py-10 text-ink-soft">
            <Spinner />
          </div>
        ) : threads.length === 0 ? (
          <EmptyState
            icon="✉️"
            title="No conversations yet"
            hint="Open someone's profile from a message and hit Message to start a private, anonymous DM."
          />
        ) : (
          <ul className="space-y-1">
            {threads.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/dm/${t.id}`}
                  className="flex items-center gap-3 rounded-xl border border-transparent p-3 transition hover:border-line hover:bg-surface-2"
                >
                  {t.other ? (
                    <Avatar seed={t.other.avatarSeed} username={t.other.username} size="md" presence={t.other.presence} />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-surface-3" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{t.other?.username ?? 'Unknown'}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-ink-soft">{timeAgo(t.lastMessageAt)}</span>
                    </div>
                    <p className={cx('truncate text-sm', t.unread > 0 ? 'font-medium text-ink' : 'text-ink-soft')}>
                      {t.lastMessage ? `${t.lastMessage.fromMe ? 'You: ' : ''}${t.lastMessage.body}` : 'No messages yet'}
                    </p>
                  </div>
                  {t.unread > 0 ? (
                    <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {t.unread}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
