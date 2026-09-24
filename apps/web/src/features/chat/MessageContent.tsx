import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, linkPreviewApi, pollsApi } from '../../lib/api';
import { applyPollUpdate } from '../../lib/messageCache';
import { useUI } from '../../store/ui';
import { cx } from '../../components/ui';
import type { PublicAttachment, PublicMessage, PublicPoll, PublicVoiceMessage } from '../../types';

const URL_RE = /(https?:\/\/[^\s]+)/i;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Everything below a message body: attachments, voice, poll, link preview. */
export function MessageContent({ message }: { message: PublicMessage }): JSX.Element | null {
  if (message.deleted) return null;
  const firstUrl = message.contentType === 'TEXT' ? URL_RE.exec(message.body)?.[1] : undefined;
  const hasExtra =
    message.attachments.length > 0 || message.voice || message.poll || firstUrl;
  if (!hasExtra) return null;

  return (
    <div className="mt-1.5 space-y-2">
      {message.voice ? <VoicePlayer voice={message.voice} /> : null}
      {message.poll ? <PollCard messageId={message.id} poll={message.poll} /> : null}
      {message.attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <AttachmentView key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}
      {firstUrl ? <LinkPreviewCard url={firstUrl} /> : null}
    </div>
  );
}

function AttachmentView({ attachment: a }: { attachment: PublicAttachment }): JSX.Element {
  if (a.kind === 'IMAGE') {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block">
        <img src={a.url} alt="attachment" loading="lazy" className="max-h-72 max-w-full rounded-xl border border-line object-cover" />
      </a>
    );
  }
  if (a.kind === 'VIDEO') {
    return <video src={a.url} controls className="max-h-72 max-w-full rounded-xl border border-line" />;
  }
  if (a.kind === 'AUDIO') {
    return <audio src={a.url} controls className="w-64" />;
  }
  const icon = a.kind === 'PDF' ? '📄' : '📎';
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm hover:border-brand-400"
    >
      <span className="text-xl">{icon}</span>
      <span>
        <span className="block font-medium">{a.kind === 'PDF' ? 'PDF document' : 'File'}</span>
        <span className="text-xs text-ink-soft">{a.mime} · {humanSize(a.size)}</span>
      </span>
    </a>
  );
}

const SPEEDS = [1, 1.5, 2, 0.5] as const;

export function VoicePlayer({ voice }: { voice: PublicVoiceMessage }): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  const peak = Math.max(1, ...voice.waveform);
  const bars = voice.waveform.length > 0 ? voice.waveform : new Array(32).fill(6);

  function toggle(): void {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play();
  }
  function cycleSpeed(): void {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  return (
    <div className="flex max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2">
      <button
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div className="flex h-8 flex-1 items-center gap-[2px]">
        {bars.slice(0, 48).map((v, i) => {
          const active = i / Math.min(bars.length, 48) <= progress;
          return (
            <span
              key={i}
              className={cx('w-[3px] rounded-full', active ? 'bg-brand-400' : 'bg-line')}
              style={{ height: `${Math.max(10, (v / peak) * 100)}%` }}
            />
          );
        })}
      </div>
      <button onClick={cycleSpeed} className="shrink-0 rounded-lg bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold">
        {SPEEDS[speedIdx]}x
      </button>
      <audio
        ref={audioRef}
        src={voice.url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
        className="hidden"
      />
    </div>
  );
}

export function PollCard({ messageId, poll }: { messageId: string; poll: PublicPoll }): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const voted = poll.myOptionIds.length > 0;

  async function vote(optionId: string): Promise<void> {
    if (poll.closed || busy) return;
    setBusy(true);
    try {
      const next =
        poll.mode === 'MULTI'
          ? poll.myOptionIds.includes(optionId)
            ? poll.myOptionIds.filter((id) => id !== optionId)
            : [...poll.myOptionIds, optionId]
          : [optionId];
      const res = await pollsApi.vote(poll.id, next.length ? next : [optionId]);
      applyPollUpdate(messageId, res.poll);
    } catch (err) {
      pushToast('error', err instanceof ApiError ? err.message : 'Could not vote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md rounded-2xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">📊</span>
        <span className="text-sm font-semibold">{poll.question}</span>
      </div>
      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const pct = poll.total > 0 ? Math.round((o.votes / poll.total) * 100) : 0;
          const mine = poll.myOptionIds.includes(o.id);
          return (
            <button
              key={o.id}
              onClick={() => void vote(o.id)}
              disabled={poll.closed}
              className={cx(
                'relative block w-full overflow-hidden rounded-lg border px-3 py-1.5 text-left text-sm transition',
                mine ? 'border-brand-500' : 'border-line hover:border-brand-400',
                poll.closed && 'cursor-default',
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-brand-600/15"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="relative flex justify-between">
                <span>{mine ? '✓ ' : ''}{o.label}</span>
                <span className="tabular-nums text-ink-soft">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-soft">
        {poll.total} vote{poll.total === 1 ? '' : 's'}
        {poll.mode === 'MULTI' ? ' · multiple choice' : ''}
        {poll.closed ? ' · closed' : voted ? ' · tap to change' : ''}
      </p>
    </div>
  );
}

function LinkPreviewCard({ url }: { url: string }): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () => linkPreviewApi.get(url),
    staleTime: 3_600_000,
    retry: false,
  });
  if (!data || (!data.title && !data.description && !data.imageUrl)) return null;
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-md gap-3 overflow-hidden rounded-xl border border-line bg-surface-2 p-2 hover:border-brand-400"
    >
      {data.imageUrl ? (
        <img src={data.imageUrl} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
      ) : null}
      <div className="min-w-0">
        {data.siteName ? <div className="truncate text-[11px] text-ink-soft">{data.siteName}</div> : null}
        {data.title ? <div className="truncate text-sm font-semibold">{data.title}</div> : null}
        {data.description ? <div className="line-clamp-2 text-xs text-ink-soft">{data.description}</div> : null}
      </div>
    </a>
  );
}
