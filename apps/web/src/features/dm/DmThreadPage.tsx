import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, dmApi, messagesApi } from '../../lib/api';
import { applyNewDmMessage, applyReactionSummary, dmKey } from '../../lib/messageCache';
import { useUI } from '../../store/ui';
import { useAuth } from '../../store/auth';
import { Avatar, Spinner } from '../../components/ui';
import { ReactionChips } from '../chat/MessageList';
import { MessageContent } from '../chat/MessageContent';
import { EmojiPicker } from '../chat/EmojiPicker';
import { useShell } from '../chat/AppShell';
import type { PublicMessage } from '../../types';

export function DmThreadPage(): JSX.Element {
  const { threadId = '' } = useParams();
  const meId = useAuth((s) => s.profile?.id);
  const pushToast = useUI((s) => s.pushToast);
  const { openSidebar } = useShell();
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);

  const threadsQuery = useQuery({ queryKey: ['dm-threads'], queryFn: dmApi.list });
  const other = threadsQuery.data?.data.find((t) => t.id === threadId)?.other ?? null;

  const query = useInfiniteQuery({
    queryKey: dmKey(threadId),
    queryFn: ({ pageParam }) => dmApi.messages(threadId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const messages = useMemo(() => {
    const all = (query.data?.pages ?? []).flatMap((p) => p.data);
    return all.slice().reverse();
  }, [query.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  // Mark the newest message read.
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (newest) {
      void dmApi.read(threadId, newest.id).then(() => qc.invalidateQueries({ queryKey: ['dm-threads'] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, messages.length]);

  async function send(): Promise<void> {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await dmApi.send(threadId, body);
      applyNewDmMessage(threadId, res.message);
      setValue('');
      void qc.invalidateQueries({ queryKey: ['dm-threads'] });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  async function toggleReaction(messageId: string, emoji: string): Promise<void> {
    try {
      const res = await messagesApi.react(messageId, emoji);
      applyReactionSummary(messageId, res.reactions);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not react.');
    }
  }

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el || !query.hasNextPage || query.isFetchingNextPage) return;
    if (el.scrollTop < 60) {
      const prev = el.scrollHeight;
      void query.fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prev;
        });
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button className="text-lg hover:opacity-70 md:hidden" onClick={openSidebar} aria-label="Menu">
          ☰
        </button>
        <Link to="/dm" className="text-ink-soft hover:text-ink">←</Link>
        {other ? (
          <Link to={`/u/${other.id}`} className="flex items-center gap-2">
            <Avatar seed={other.avatarSeed} username={other.username} size="sm" presence={other.presence} />
            <span className="font-bold">{other.username}</span>
          </Link>
        ) : (
          <span className="font-bold">Conversation</span>
        )}
        <span className="ml-auto text-[11px] text-ink-soft">Private &amp; anonymous</span>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {query.isFetchingNextPage ? (
          <div className="flex justify-center py-2 text-ink-soft"><Spinner /></div>
        ) : null}
        {query.isLoading ? (
          <div className="flex h-full items-center justify-center text-ink-soft"><Spinner /></div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-ink-soft">
            <span className="text-3xl">👋</span>
            <p className="text-sm">Say hi — this conversation is private and anonymous.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {messages.map((m) => (
            <DmBubble key={m.id} message={m} mine={m.author.id === meId} onToggle={toggleReaction} />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-1.5 focus-within:border-brand-500">
          <div className="relative">
            <button className="pb-1.5 text-lg opacity-70 hover:opacity-100" title="Emoji" onClick={() => setShowEmoji((v) => !v)}>
              😊
            </button>
            {showEmoji ? (
              <div className="absolute bottom-10 left-0">
                <EmojiPicker onSelect={(e) => { setValue((v) => v + e); setShowEmoji(false); }} onClose={() => setShowEmoji(false)} />
              </div>
            ) : null}
          </div>
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message…"
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-soft/60"
          />
          <button onClick={() => void send()} disabled={!value.trim() || sending} className="btn-primary h-9 px-4 py-0">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function DmBubble({
  message,
  mine,
  onToggle,
}: {
  message: PublicMessage;
  mine: boolean;
  onToggle: (messageId: string, emoji: string) => void;
}): JSX.Element {
  return (
    <div className={mine ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
      {message.body ? (
        <div
          className={
            mine
              ? 'max-w-[75%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white'
              : 'max-w-[75%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-ink'
          }
        >
          <p className="whitespace-pre-wrap break-words">
            {message.deleted ? <span className="italic opacity-70">message deleted</span> : message.body}
          </p>
        </div>
      ) : null}
      <div className="max-w-[75%]">
        <MessageContent message={message} />
      </div>
      <div className={mine ? 'items-end' : 'items-start'}>
        <ReactionChips message={message} onToggle={(emoji) => onToggle(message.id, emoji)} />
      </div>
      <span className="mt-0.5 text-[10px] text-ink-soft">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
