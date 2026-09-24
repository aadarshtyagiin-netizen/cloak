import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../../lib/api';
import { Avatar, Spinner } from '../../components/ui';
import { useShell } from '../chat/AppShell';

export function SearchPage(): JSX.Element {
  const { openSidebar } = useShell();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.search(q),
    enabled: q.length > 0,
  });
  const results = data?.data ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>☰ Menu</button>
        <h1 className="mb-3 text-xl font-extrabold">🔍 Search</h1>
        <input
          autoFocus
          className="input"
          placeholder="Search messages…  try  from:BlueFox42  channel:technology  has:image  after:2026-09-01"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-ink-soft">
          {['from:user', 'channel:slug', 'has:image', 'has:video', 'has:link', 'after:2026-09-01'].map((f) => (
            <span key={f} className="rounded bg-surface-3 px-1.5 py-0.5">{f}</span>
          ))}
        </div>

        <div className="mt-6">
          {q.length === 0 ? (
            <p className="text-sm text-ink-soft">Type to search across channels you can see.</p>
          ) : isFetching ? (
            <div className="flex justify-center py-8 text-ink-soft"><Spinner /></div>
          ) : results.length === 0 ? (
            <p className="text-sm text-ink-soft">No messages match “{q}”.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((r) => (
                <li key={r.message.id}>
                  <Link to={r.channel ? `/c/${r.channel.id}` : '#'} className="block rounded-xl border border-line p-3 hover:bg-surface-2">
                    <div className="flex items-center gap-2 text-xs text-ink-soft">
                      <Avatar seed={r.message.author.avatarSeed} username={r.message.author.username} size="sm" />
                      <span className="font-semibold text-ink">{r.message.author.username}</span>
                      {r.channel ? <span>in #{r.channel.name}</span> : null}
                      <span className="ml-auto">{new Date(r.message.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm">
                      {r.message.body || (r.message.attachments.length ? '📎 attachment' : r.message.poll ? '📊 poll' : r.message.voice ? '🎙️ voice message' : '')}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
