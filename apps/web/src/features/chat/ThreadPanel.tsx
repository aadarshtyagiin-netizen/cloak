import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, channelsApi, messagesApi } from '../../lib/api';
import { applyReactionSummary } from '../../lib/messageCache';
import { useUI } from '../../store/ui';
import { Avatar, Spinner, cx } from '../../components/ui';
import { ReactionChips } from './MessageList';
import type { PublicChannel, PublicMessage } from '../../types';

export function ThreadPanel({
  channel,
  rootMessageId,
  onClose,
}: {
  channel: PublicChannel;
  rootMessageId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const threadKey = ['thread', rootMessageId] as const;
  const { data, isLoading } = useQuery({
    queryKey: threadKey,
    queryFn: () => messagesApi.thread(rootMessageId),
  });

  async function toggleReaction(messageId: string, emoji: string): Promise<void> {
    try {
      const res = await messagesApi.react(messageId, emoji);
      applyReactionSummary(messageId, res.reactions);
      void qc.invalidateQueries({ queryKey: threadKey });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not react.');
    }
  }

  async function sendReply(): Promise<void> {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await channelsApi.send(channel.id, body, { parentId: rootMessageId });
      setValue('');
      void qc.invalidateQueries({ queryKey: threadKey });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not reply.');
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="flex w-full flex-col border-l border-line bg-surface md:w-96">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Thread</h2>
          <p className="text-xs text-ink-soft">
            {data ? `${data.replyCount} ${data.replyCount === 1 ? 'reply' : 'replies'}` : '…'}
          </p>
        </div>
        <button className="btn-ghost h-8 px-2 py-0" onClick={onClose} title="Close thread">
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-6 text-ink-soft">
            <Spinner />
          </div>
        ) : data ? (
          <div className="space-y-4">
            <ThreadMessage message={data.root} onToggle={toggleReaction} root />
            {data.replies.length > 0 ? (
              <div className="relative space-y-3 border-t border-line pt-3">
                {data.replies.map((r) => (
                  <ThreadMessage key={r.id} message={r} onToggle={toggleReaction} />
                ))}
              </div>
            ) : (
              <p className="pt-3 text-center text-xs text-ink-soft">No replies yet. Start the thread.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-1.5 focus-within:border-brand-500">
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendReply();
              }
            }}
            placeholder="Reply…"
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-soft/60"
          />
          <button
            onClick={() => void sendReply()}
            disabled={!value.trim() || sending}
            className="btn-primary h-8 px-3 py-0 text-xs"
          >
            Reply
          </button>
        </div>
      </div>
    </aside>
  );
}

function ThreadMessage({
  message,
  onToggle,
  root,
}: {
  message: PublicMessage;
  onToggle: (messageId: string, emoji: string) => void;
  root?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className={cx('flex gap-2', root && 'rounded-xl bg-surface-2 p-2')}>
      <button onClick={() => navigate(`/u/${message.author.id}`)}>
        <Avatar seed={message.author.avatarSeed} username={message.author.username} size="sm" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold">{message.author.username}</span>
          <span className="text-[10px] text-ink-soft">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-ink">
          {message.deleted ? <span className="italic text-ink-soft/70">message deleted</span> : message.body}
        </p>
        <ReactionChips message={message} onToggle={(emoji) => onToggle(message.id, emoji)} />
      </div>
    </div>
  );
}
