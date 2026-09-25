import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hash, Menu, Users, Pin } from 'lucide-react';
import { channelExtrasApi } from '../../lib/api';
import { cx } from '../../components/ui';
import type { PublicChannel } from '../../types';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { ThreadPanel } from './ThreadPanel';

export function ChatView({
  channel,
  onOpenSidebar,
}: {
  channel: PublicChannel;
  onOpenSidebar?: () => void;
}): JSX.Element {
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  const [showPins, setShowPins] = useState(false);

  const pins = useQuery({
    queryKey: ['pins', channel.id],
    queryFn: () => channelExtrasApi.pins(channel.id),
    enabled: showPins,
  });

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3 shadow-sm">
          {onOpenSidebar ? (
            <button
              className="chrome-btn -ml-1 md:hidden"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
          ) : null}
          <Hash className="h-5 w-5 shrink-0 text-ink-soft" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight">{channel.name}</h1>
            <p className="truncate text-xs text-ink-soft">
              {channel.topic ?? channel.description ?? 'No topic set'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-ink-soft">
            <span
              title="Members"
              className="hidden items-center gap-1.5 rounded-lg bg-surface-3 px-2 py-1 text-xs font-medium sm:inline-flex"
            >
              <Users className="h-4 w-4" /> {channel.memberCount}
            </span>
            <div className="relative">
              <button
                className={cx('chrome-btn', showPins && 'bg-surface-3 text-ink')}
                title="Pinned messages"
                aria-label="Pinned messages"
                onClick={() => setShowPins((v) => !v)}
              >
                <Pin className="h-5 w-5" />
              </button>
              {showPins ? (
                <div className="absolute right-0 top-9 z-40 w-80 rounded-xl border border-line bg-surface-2 p-2 shadow-xl">
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                    Pinned
                  </div>
                  {pins.data && pins.data.data.length > 0 ? (
                    <ul className="max-h-72 space-y-1 overflow-y-auto">
                      {pins.data.data.map((p) => (
                        <li key={p.message.id} className="rounded-lg bg-surface p-2 text-sm">
                          <div className="text-[11px] font-medium text-ink-soft">
                            {p.message.author.username}
                          </div>
                          <p className="line-clamp-3 whitespace-pre-wrap break-words text-ink">
                            {p.message.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-1 py-3 text-center text-xs text-ink-soft">
                      No pinned messages yet. Use a message's ⋯ menu to pin it.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <MessageList channel={channel} onOpenThread={(id) => setThreadRoot(id)} />
        <TypingIndicator channelId={channel.id} />
        <Composer channel={channel} />
      </div>

      {threadRoot ? (
        <ThreadPanel channel={channel} rootMessageId={threadRoot} onClose={() => setThreadRoot(null)} />
      ) : null}
    </div>
  );
}
