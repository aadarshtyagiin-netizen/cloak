import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, channelsApi, pollsApi, uploadMedia } from '../../lib/api';
import { applyNewMessage } from '../../lib/messageCache';
import { useSocket } from '../../lib/socket';
import { useUI } from '../../store/ui';
import { useVoiceRecorder } from '../../lib/useVoiceRecorder';
import { Avatar, Modal, cx } from '../../components/ui';
import {
  Smile,
  BarChart3,
  Paperclip,
  Mic,
  X,
  Image as ImageIcon,
  Film,
  Send,
  Megaphone,
  Trash2,
  Plus,
} from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import type { PublicAttachment, PublicChannel, PublicProfile } from '../../types';

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface MentionItem {
  username: string;
  profile?: PublicProfile;
  broadcast?: boolean;
}

// The @token immediately before the caret (start-of-line or after whitespace).
const MENTION_AT_CARET = /(?:^|\s)@([A-Za-z0-9_]{0,24})$/;

export function Composer({ channel }: { channel: PublicChannel }): JSX.Element {
  const socket = useSocket();
  const pushToast = useUI((s) => s.pushToast);
  const prefill = useUI((s) => s.prefill);
  const clearPrefill = useUI((s) => s.clearPrefill);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pending, setPending] = useState<PublicAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const typingRef = useRef(false);
  const stopTimer = useRef<number | undefined>(undefined);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  // Members are only fetched once the user actually starts an @mention.
  const membersQuery = useQuery({
    queryKey: ['channel-members', channel.id],
    queryFn: () => channelsApi.members(channel.id),
    enabled: mentionQuery !== null,
    staleTime: 60_000,
  });

  const suggestions = useMemo<MentionItem[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const users: MentionItem[] = (membersQuery.data?.data ?? [])
      .map((m) => m.profile)
      .filter((p) => p.username.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ username: p.username, profile: p }));
    const broadcasts: MentionItem[] = (['everyone', 'channel'] as const)
      .filter((b) => b.startsWith(q))
      .map((b) => ({ username: b, broadcast: true }));
    return [...users, ...broadcasts].slice(0, 7);
  }, [mentionQuery, membersQuery.data]);

  const mentionOpen = mentionQuery !== null && suggestions.length > 0;

  useEffect(() => {
    if (prefill && prefill.channelId === channel.id) {
      setValue((v) => (v ? `${v}\n${prefill.text}` : prefill.text));
      clearPrefill();
      requestAnimationFrame(() => {
        autoresize();
        taRef.current?.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, channel.id, clearPrefill]);

  function autoresize(): void {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  function stopTyping(): void {
    if (socket && typingRef.current) {
      typingRef.current = false;
      window.clearTimeout(stopTimer.current);
      socket.emit('typing:stop', { channelId: channel.id });
    }
  }

  /** Recompute the active @mention token from the text just before the caret. */
  function detectMention(el: HTMLTextAreaElement): void {
    const caret = el.selectionStart ?? el.value.length;
    const m = MENTION_AT_CARET.exec(el.value.slice(0, caret));
    if (m) {
      setMentionQuery(m[1]);
      setMentionIdx(0);
    } else if (mentionQuery !== null) {
      setMentionQuery(null);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setValue(e.target.value);
    autoresize();
    detectMention(e.target);
    if (!socket) return;
    if (!typingRef.current) {
      typingRef.current = true;
      socket.emit('typing:start', { channelId: channel.id });
    }
    window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(stopTyping, 2000);
  }

  /** Insert text at the caret (or replace the current selection), then restore focus. */
  function insertAtCaret(snippet: string): void {
    const el = taRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      autoresize();
      el?.focus();
      const pos = start + snippet.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  /** Replace the half-typed @token at the caret with the chosen handle. */
  function applyMention(username: string): void {
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const rest = value.slice(caret);
    const replaced = upto.replace(/@([A-Za-z0-9_]{0,24})$/, `@${username} `);
    setValue(replaced + rest);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      autoresize();
      el?.focus();
      el?.setSelectionRange(replaced.length, replaced.length);
    });
  }

  async function uploadFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files).slice(0, 10);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        const att = await uploadMedia(file);
        setPending((p) => [...p, att]);
      }
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function send(): Promise<void> {
    const body = value.trim();
    if ((!body && pending.length === 0) || sending) return;
    setSending(true);
    stopTyping();
    setMentionQuery(null);
    try {
      const res = await channelsApi.send(channel.id, body, { attachmentIds: pending.map((a) => a.id) });
      applyNewMessage(res.message);
      setValue('');
      setPending([]);
      requestAnimationFrame(autoresize);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // The mention menu owns arrow/enter/tab/escape while it's open.
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(suggestions[Math.min(mentionIdx, suggestions.length - 1)].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  function onPaste(e: React.ClipboardEvent): void {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files);
    }
  }

  async function startVoice(): Promise<void> {
    const ok = await recorder.start();
    if (!ok) pushToast('error', 'Microphone unavailable or permission denied.');
  }

  async function finishVoice(): Promise<void> {
    const rec = await recorder.stop();
    if (!rec) return;
    setSending(true);
    try {
      const att = await uploadMedia(rec.blob, { durationMs: rec.durationMs });
      const res = await channelsApi.send(channel.id, '', {
        voice: { attachmentId: att.id, durationMs: rec.durationMs, waveform: rec.waveform },
      });
      applyNewMessage(res.message);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not send voice message.');
    } finally {
      setSending(false);
    }
  }

  if (recorder.recording) {
    return (
      <div className="px-4 pb-4">
        <div className="flex items-center gap-3 rounded-2xl border border-danger/50 bg-surface-2 px-4 py-3 shadow-sm">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger/60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
          </span>
          <span className="flex-1 text-sm font-medium">Recording… {fmtDuration(recorder.elapsedMs)}</span>
          <button className="btn-ghost h-8 gap-1.5 px-3 py-0 text-xs" onClick={() => recorder.cancel()}>
            <Trash2 className="h-4 w-4" /> Cancel
          </button>
          <button className="btn-primary h-8 gap-1.5 px-3 py-0 text-xs" onClick={() => void finishVoice()}>
            <Send className="h-4 w-4" /> Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="px-4 pb-4 pt-1"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void uploadFiles(e.dataTransfer.files);
      }}
    >
      {pending.length > 0 || uploading ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs">
              <span className="text-ink-soft">
                {a.kind === 'IMAGE' ? <ImageIcon className="h-4 w-4" /> : a.kind === 'VIDEO' ? <Film className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
              </span>
              <span className="max-w-[140px] truncate">{a.mime}</span>
              <button
                type="button"
                aria-label="Remove attachment"
                className="flex h-6 w-6 items-center justify-center rounded text-ink-soft transition hover:bg-surface-3 hover:text-danger"
                onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {uploading ? <span className="self-center text-xs text-ink-soft">Uploading…</span> : null}
        </div>
      ) : null}

      <div className="relative">
        {mentionOpen ? (
          <div className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-xl border border-line bg-surface-2 py-1.5 shadow-pop-lg animate-pop-in">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Members
            </div>
            {suggestions.map((s, i) => (
              <button
                key={s.broadcast ? `b:${s.username}` : `u:${s.profile?.id ?? s.username}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus so applyMention can restore the caret
                  applyMention(s.username);
                }}
                onMouseEnter={() => setMentionIdx(i)}
                className={cx(
                  'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm transition-colors',
                  i === mentionIdx ? 'bg-brand-500/15' : 'hover:bg-surface-3',
                )}
              >
                {s.broadcast ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning/20 text-warning">
                    <Megaphone className="h-4 w-4" />
                  </span>
                ) : (
                  <Avatar seed={s.profile!.avatarSeed} username={s.username} size="sm" url={s.profile!.avatarUrl} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-ink">@{s.username}</span>
                  {s.broadcast ? (
                    <span className="ml-1.5 text-xs text-ink-soft">notify the whole channel</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={cx(
            'flex items-end gap-1 rounded-2xl border px-2 py-1.5 transition-[border-color,box-shadow]',
            dragOver
              ? 'border-brand-500 bg-brand-500/5 ring-2 ring-brand-500/30'
              : 'border-line bg-surface-3 focus-within:border-brand-500/60',
          )}
        >
          <div className="relative">
            <button
              type="button"
              aria-label="Insert emoji"
              title="Emoji"
              className={cx('chrome-btn', showEmoji && 'bg-surface-2 text-ink')}
              onClick={() => setShowEmoji((v) => !v)}
            >
              <Smile className="h-5 w-5" />
            </button>
            {showEmoji ? (
              <div className="absolute bottom-12 left-0">
                <EmojiPicker
                  onSelect={(e) => {
                    insertAtCaret(e);
                    setShowEmoji(false);
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              </div>
            ) : null}
          </div>
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => detectMention(e.currentTarget)}
            onClick={(e) => detectMention(e.currentTarget)}
            onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
            onPaste={onPaste}
            placeholder={`Message #${channel.name}`}
            className="max-h-44 flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-sm leading-relaxed outline-none placeholder:text-ink-soft/70"
          />
          <button
            type="button"
            aria-label="Create poll"
            title="Create poll"
            className="chrome-btn"
            onClick={() => setPollOpen(true)}
          >
            <BarChart3 className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Attach file"
            title="Attach file"
            className="chrome-btn"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="h-5 w-5" />
          </button>
          {recorder.supported ? (
            <button
              type="button"
              aria-label="Record voice message"
              title="Record voice message"
              className="chrome-btn"
              onClick={() => void startVoice()}
            >
              <Mic className="h-5 w-5" />
            </button>
          ) : null}
          <button
            onClick={() => void send()}
            disabled={(!value.trim() && pending.length === 0) || sending}
            aria-label="Send message"
            title="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm transition hover:bg-brand-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-soft disabled:shadow-none"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-ink-soft">
        <kbd className="rounded bg-surface-3 px-1 font-sans">Enter</kbd> to send ·
        <kbd className="ml-1 rounded bg-surface-3 px-1 font-sans">Shift+Enter</kbd> for a new line ·
        <span className="ml-1">@ to mention · drag &amp; drop or paste to attach</span>
      </p>

      <CreatePollModal channelId={channel.id} open={pollOpen} onClose={() => setPollOpen(false)} />
    </div>
  );
}

function CreatePollModal({ channelId, open, onClose }: { channelId: string; open: boolean; onClose: () => void }): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) {
      pushToast('error', 'Add a question and at least two options.');
      return;
    }
    setBusy(true);
    try {
      const res = await pollsApi.create({ channelId, question: question.trim(), options: opts, mode: multi ? 'MULTI' : 'SINGLE' });
      applyNewMessage(res.message);
      setQuestion('');
      setOptions(['', '']);
      setMulti(false);
      onClose();
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not create poll.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a poll">
      <div className="space-y-3">
        <input className="input py-2 text-sm" placeholder="Ask a question…" value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="input py-2 text-sm"
                placeholder={`Option ${i + 1}`}
                value={o}
                onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 ? (
                <button
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-3 hover:text-danger"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
          {options.length < 10 ? (
            <button className="flex items-center gap-1.5 text-sm font-medium text-brand-300 hover:underline" onClick={() => setOptions((prev) => [...prev, ''])}>
              <Plus className="h-4 w-4" /> Add option
            </button>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          Allow multiple choices
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => void create()} disabled={busy}>Create poll</button>
      </div>
    </Modal>
  );
}
