import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { channelExtrasApi } from '../../lib/api';
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
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          {onOpenSidebar ? (
            <button
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-surface-3 md:hidden"
              onClick={onOpenSidebar}
              aria-label="Open sidebar"
            >
              ☰
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1 text-base font-bold">
              <span className="text-ink-soft">#</span>
              {channel.name}
            </h1>
            <p className="truncate text-xs text-ink-soft">
              {channel.topic ?? channel.description ?? 'No topic set'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span title="Members" className="hidden sm:inline">
              👥 {channel.memberCount}
            </span>
            <div className="relative">
              <button
                className="rounded-lg px-2 py-1 hover:bg-surface-3"
                title="Pinned messages"
                onClick={() => setShowPins((v) => !v)}
              >
                📌
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
