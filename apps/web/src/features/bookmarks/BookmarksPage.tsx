import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, bookmarksApi, messagesApi } from '../../lib/api';
import { useUI } from '../../store/ui';
import { Avatar, EmptyState, Spinner } from '../../components/ui';
import { useShell } from '../chat/AppShell';

export function BookmarksPage(): JSX.Element {
  const { openSidebar } = useShell();
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const { data, isLoading } = useQuery({ queryKey: ['bookmarks'], queryFn: bookmarksApi.list });
  const items = data?.data ?? [];

  async function remove(messageId: string): Promise<void> {
    try {
      await messagesApi.toggleBookmark(messageId);
      void qc.invalidateQueries({ queryKey: ['bookmarks'] });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not remove.');
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>
          ☰ Menu
        </button>
        <h1 className="mb-4 text-xl font-extrabold">🔖 Bookmarks</h1>

        {isLoading ? (
          <div className="flex justify-center py-10 text-ink-soft"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon="🔖" title="No bookmarks yet" hint="Use a message's ⋯ menu and choose Bookmark to save it here." />
        ) : (
          <ul className="space-y-3">
            {items.map((b) => (
              <li key={b.message.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <Avatar seed={b.message.author.avatarSeed} username={b.message.author.username} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="font-semibold text-ink">{b.message.author.username}</span>
                      <span>· saved {new Date(b.bookmarkedAt).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{b.message.body}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      {b.message.channelId ? (
                        <Link to={`/c/${b.message.channelId}`} className="text-brand-300 hover:underline">
                          Go to channel →
                        </Link>
                      ) : null}
                      <button className="text-ink-soft hover:text-rose-400" onClick={() => void remove(b.message.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
