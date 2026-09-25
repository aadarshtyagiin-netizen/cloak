import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, channelExtrasApi, channelsApi, messagesApi, moderationApi } from '../../lib/api';
import {
  applyDeletedMessage,
  applyReactionSummary,
  applyUpdatedMessage,
  messagesKey,
} from '../../lib/messageCache';
import { useSocket } from '../../lib/socket';
import { useAuth } from '../../store/auth';
import { useUI } from '../../store/ui';
import { SmilePlus, MessageSquare, MoreHorizontal } from 'lucide-react';
import { QUICK_REACTIONS } from '../../lib/emoji';
import { Avatar, Modal, Spinner, cx } from '../../components/ui';
import { EmojiPicker } from './EmojiPicker';
import { MessageContent } from './MessageContent';
import { MessageBody } from './MessageBody';
import type { PublicChannel, PublicMessage, PublicProfile } from '../../types';

interface Group {
  id: string;
  author: PublicProfile;
  messages: PublicMessage[];
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function groupMessages(messages: PublicMessage[]): Group[] {
  const groups: Group[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.author.id === m.author.id &&
      new Date(m.createdAt).getTime() - new Date(last.messages[last.messages.length - 1].createdAt).getTime() <
        GROUP_WINDOW_MS
    ) {
      last.messages.push(m);
    } else {
      groups.push({ id: m.id, author: m.author, messages: [m] });
    }
  }
  return groups;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageList({
  channel,
  onOpenThread,
}: {
  channel: PublicChannel;
  onOpenThread?: (rootMessageId: string) => void;
}): JSX.Element {
  const socket = useSocket();
  const meId = useAuth((s) => s.profile?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const query = useInfiniteQuery({
    queryKey: messagesKey(channel.id),
    queryFn: ({ pageParam }) => channelsApi.messages(channel.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const messages = useMemo(() => {
    const all = (query.data?.pages ?? []).flatMap((p) => p.data);
    return all.slice().reverse();
  }, [query.data]);

  useEffect(() => {
    if (!socket) return;
    // Join now if already connected, and re-join on every (re)connect so
    // realtime resumes after a network drop instead of silently going quiet.
    const resume = (): void => {
      socket.emit('channel:join', { channelId: channel.id });
      void query.refetch();
    };
    if (socket.connected) socket.emit('channel:join', { channelId: channel.id });
    socket.on('connect', resume);
    return () => {
      socket.emit('channel:leave', { channelId: channel.id });
      socket.off('connect', resume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, channel.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (messages.length > lastCount.current && (nearBottom || lastCount.current === 0)) {
      bottomRef.current?.scrollIntoView({ behavior: lastCount.current === 0 ? 'auto' : 'smooth' });
    }
    lastCount.current = messages.length;
  }, [messages.length]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el || !query.hasNextPage || query.isFetchingNextPage) return;
    if (el.scrollTop < 60) {
      const prevHeight = el.scrollHeight;
      void query.fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
        });
      });
    }
  }

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
      {query.isFetchingNextPage ? (
        <div className="flex justify-center py-2 text-ink-soft">
          <Spinner />
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="flex h-full items-center justify-center text-ink-soft">
          <Spinner />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-ink-soft">
          <span className="text-3xl">👋</span>
          <p className="font-medium text-ink">Welcome to #{channel.name}</p>
          <p className="text-sm">This is the beginning of the channel. Say something!</p>
        </div>
      ) : null}

      <div className="space-y-5">
        {groups.map((g) => (
          <MessageGroup key={g.id} group={g} channel={channel} meId={meId} onOpenThread={onOpenThread} />
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function MessageGroup({
  group,
  channel,
  meId,
  onOpenThread,
}: {
  group: Group;
  channel: PublicChannel;
  meId?: string;
  onOpenThread?: (rootMessageId: string) => void;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="flex gap-3">
      <button onClick={() => navigate(`/u/${group.author.id}`)} title="View profile">
        <Avatar seed={group.author.avatarSeed} username={group.author.username} size="md" url={group.author.avatarUrl} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => navigate(`/u/${group.author.id}`)}
            className="text-sm font-semibold hover:underline"
          >
            {group.author.username}
          </button>
          <span className="text-[11px] text-ink-soft">{formatTime(group.messages[0].createdAt)}</span>
        </div>
        <div className="space-y-0.5">
          {group.messages.map((m) => (
            <MessageLine
              key={m.id}
              message={m}
              channel={channel}
              isOwn={m.author.id === meId}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReactionChips({
  message,
  onToggle,
}: {
  message: PublicMessage;
  onToggle: (emoji: string) => void;
}): JSX.Element | null {
  if (message.reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle(r.emoji)}
          className={cx(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition hover:border-brand-400',
            r.reactedByMe ? 'border-brand-500 bg-brand-600/15' : 'border-line bg-surface-3',
          )}
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

function MessageLine({
  message,
  channel,
  isOwn,
  onOpenThread,
}: {
  message: PublicMessage;
  channel: PublicChannel;
  isOwn: boolean;
  onOpenThread?: (rootMessageId: string) => void;
}): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const setPrefill = useUI((s) => s.setPrefill);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  if (message.deleted) {
    return <p className="text-sm italic text-ink-soft/70">message deleted</p>;
  }

  async function toggleReaction(emoji: string): Promise<void> {
    setPicker(false);
    try {
      const res = await messagesApi.react(message.id, emoji);
      applyReactionSummary(message.id, res.reactions);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not react.');
    }
  }

  async function toggleBookmark(): Promise<void> {
    setMenu(false);
    try {
      const res = await messagesApi.toggleBookmark(message.id);
      pushToast('success', res.bookmarked ? 'Saved to bookmarks' : 'Removed bookmark');
      void qc.invalidateQueries({ queryKey: ['bookmarks'] });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not bookmark.');
    }
  }

  async function togglePin(): Promise<void> {
    setMenu(false);
    try {
      const res = await channelExtrasApi.togglePin(channel.id, message.id);
      pushToast('info', res.pinned ? 'Pinned to channel' : 'Unpinned');
      void qc.invalidateQueries({ queryKey: ['pins', channel.id] });
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not pin.');
    }
  }

  async function saveEdit(): Promise<void> {
    const body = draft.trim();
    if (!body || body === message.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await messagesApi.edit(message.id, body);
      applyUpdatedMessage(channel.id, message.id, res.message.body, res.message.editedAt);
      setEditing(false);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Failed to edit.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setMenu(false);
    if (!window.confirm('Delete this message?')) return;
    try {
      await messagesApi.remove(message.id);
      applyDeletedMessage(channel.id, message.id);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Failed to delete.');
    }
  }

  function copy(): void {
    setMenu(false);
    void navigator.clipboard?.writeText(message.body);
    pushToast('info', 'Copied to clipboard');
  }

  if (editing) {
    return (
      <div className="py-1">
        <textarea
          autoFocus
          className="input py-2 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void saveEdit();
            }
          }}
        />
        <div className="mt-1 flex gap-2 text-xs text-ink-soft">
          <button className="hover:text-ink" onClick={() => void saveEdit()} disabled={busy}>
            Save
          </button>
          <button className="hover:text-ink" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <span>· Esc to cancel</span>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative -mx-2 rounded-lg px-2 py-0.5 transition-colors hover:bg-surface-2/70">
      {message.body && message.contentType !== 'POLL' ? (
        <MessageBody body={message.body} editedAt={message.editedAt} />
      ) : null}

      <MessageContent message={message} />

      <ReactionChips message={message} onToggle={toggleReaction} />

      {/* Hover toolbar */}
      <div className="absolute -top-4 right-2 hidden items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5 shadow-pop group-hover:flex">
        {QUICK_REACTIONS.slice(0, 4).map((e) => (
          <button
            key={e}
            title={`React ${e}`}
            onClick={() => void toggleReaction(e)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-base transition hover:scale-110 hover:bg-surface-3"
          >
            {e}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <div className="relative">
          <HoverAction title="Add reaction" onClick={() => setPicker((v) => !v)} label={<SmilePlus className="h-[18px] w-[18px]" />} />
          {picker ? (
            <div className="absolute bottom-9 right-0 z-50">
              <EmojiPicker onSelect={(e) => void toggleReaction(e)} onClose={() => setPicker(false)} />
            </div>
          ) : null}
        </div>
        {onOpenThread && !message.parentId ? (
          <HoverAction
            title="Reply in thread"
            onClick={() => onOpenThread(message.id)}
            label={<MessageSquare className="h-[18px] w-[18px]" />}
          />
        ) : null}
        <div className="relative">
          <HoverAction title="More" onClick={() => setMenu((v) => !v)} label={<MoreHorizontal className="h-[18px] w-[18px]" />} />
          {menu ? (
            <div className="absolute bottom-9 right-0 z-40 w-44 rounded-xl border border-line bg-surface-2 py-1 text-sm shadow-pop-lg">
              <MenuItem label="Copy text" onClick={copy} />
              <MenuItem
                label="Quote"
                onClick={() => {
                  setMenu(false);
                  setPrefill(channel.id, `> ${message.author.username}: ${message.body.split('\n')[0]}\n`);
                }}
              />
              <MenuItem label="Forward" onClick={() => { setMenu(false); setForwarding(true); }} />
              <MenuItem label="Bookmark" onClick={() => void toggleBookmark()} />
              <MenuItem label="Pin to channel" onClick={() => void togglePin()} />
              {isOwn ? <MenuItem label="Edit" onClick={() => { setMenu(false); setEditing(true); }} /> : null}
              {isOwn ? <MenuItem label="Delete" danger onClick={() => void remove()} /> : null}
              {!isOwn ? <MenuItem label="Report" danger onClick={() => { setMenu(false); setReporting(true); }} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        targetMessageId={message.id}
      />
      <ForwardDialog open={forwarding} onClose={() => setForwarding(false)} body={message.body} />
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cx(
        'block w-full px-3 py-1.5 text-left hover:bg-surface-3',
        danger ? 'text-rose-400' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}

function HoverAction({
  title,
  onClick,
  label,
}: {
  title: string;
  onClick: () => void;
  label: React.ReactNode;
}): JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-3 hover:text-ink"
    >
      {label}
    </button>
  );
}

export function ReportDialog({
  open,
  onClose,
  targetMessageId,
  targetProfileId,
}: {
  open: boolean;
  onClose: () => void;
  targetMessageId?: string;
  targetProfileId?: string;
}): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await moderationApi.report({
        targetType: targetMessageId ? 'MESSAGE' : 'USER',
        targetMessageId,
        targetProfileId,
        reason: reason.trim(),
      });
      pushToast('success', 'Report submitted. Thank you.');
      setReason('');
      onClose();
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not submit report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Report to moderators">
      <p className="mb-3 text-sm text-ink-soft">
        Tell moderators what's wrong. Reports are reviewed privately; the reported person is not told who reported them.
      </p>
      <textarea
        autoFocus
        className="input py-2 text-sm"
        rows={3}
        placeholder="Reason (e.g. spam, harassment, off-topic)…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => void submit()} disabled={busy || !reason.trim()}>
          Submit report
        </button>
      </div>
    </Modal>
  );
}



function ForwardDialog({ open, onClose, body }: { open: boolean; onClose: () => void; body: string }): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list, enabled: open });

  async function forward(channelId: string): Promise<void> {
    setBusy(true);
    try {
      await channelsApi.send(channelId, body);
      pushToast('success', 'Message forwarded');
      onClose();
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not forward.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Forward to channel">
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {(data?.data ?? []).map((c) => (
          <button
            key={c.id}
            disabled={busy}
            onClick={() => void forward(c.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3"
          >
            <span className="text-ink-soft">#</span>
            <span className="truncate">{c.name}</span>
          </button>
        ))}
        {(data?.data ?? []).length === 0 ? <p className="p-3 text-sm text-ink-soft">No channels available.</p> : null}
      </div>
    </Modal>
  );
}
