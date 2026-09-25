import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, Loader2, FileText, File as FileIcon } from 'lucide-react';
import { ApiError, linkPreviewApi, pollsApi } from '../../lib/api';
import { applyPollUpdate } from '../../lib/messageCache';
import { useUI } from '../../store/ui';
import { cx } from '../../components/ui';
import type { PublicAttachment, PublicMessage, PublicPoll, PublicVoiceMessage } from '../../types';

function fmtTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
    return <audio src={a.url} controls preload="metadata" className="w-64" />;
  }
  const Icon = a.kind === 'PDF' ? FileText : FileIcon;
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm transition hover:border-brand-400 hover:bg-surface-3"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-brand-300">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-medium">{a.kind === 'PDF' ? 'PDF document' : 'File'}</span>
        <span className="text-xs text-ink-soft">{a.mime} · {humanSize(a.size)}</span>
      </span>
    </a>
  );
}

const SPEEDS = [1, 1.5, 2, 0.5] as const;

export function VoicePlayer({ voice }: { voice: PublicVoiceMessage }): JSX.Element {
  const pushToast = useUI((s) => s.pushToast);
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const triedFallback = useRef(false);
  const [src, setSrc] = useState(voice.url);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [metaDuration, setMetaDuration] = useState(0);

  // Clips recorded with MediaRecorder (webm/opus) usually report
  // duration = Infinity, so trust the server's durationMs and only override it
  // with a *finite* value the element reports. Progress is derived from this
  // (not el.duration) — otherwise the bar/time stay stuck at 0 while it plays.
  const total = metaDuration > 0 ? metaDuration : voice.durationMs / 1000;
  const progress = total > 0 ? Math.min(1, currentTime / total) : 0;

  const peak = Math.max(1, ...voice.waveform);
  const bars = voice.waveform.length > 0 ? voice.waveform : new Array(40).fill(8);
  const shown = bars.slice(0, 56);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  async function toggle(): Promise<void> {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    setLoading(true);
    try {
      await el.play();
      setLoading(false);
    } catch {
      // Streaming playback can fail on some proxy/Range/codec combinations. Fall
      // back to fetching the whole clip once and playing it from an object URL.
      if (triedFallback.current) {
        setLoading(false);
        pushToast('error', 'Could not play this voice message.');
        return;
      }
      triedFallback.current = true;
      try {
        const res = await fetch(voice.url);
        if (!res.ok) throw new Error('fetch failed');
        const url = URL.createObjectURL(await res.blob());
        objectUrlRef.current = url;
        setSrc(url); // keep React's prop in sync so it isn't reverted on re-render
        el.src = url;
        el.load();
        await el.play();
        setLoading(false);
      } catch {
        setLoading(false);
        pushToast('error', 'Could not play this voice message.');
      }
    }
  }

  function cycleSpeed(): void {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  function seek(clientX: number): void {
    const el = audioRef.current;
    const bar = barsRef.current;
    if (!el || !bar || total <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try {
      el.currentTime = ratio * total;
    } catch {
      /* some streamed clips can't seek — ignore */
    }
    setCurrentTime(ratio * total);
  }

  return (
    <div className="flex max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
      <button
        onClick={() => void toggle()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-sm transition hover:bg-brand-600 active:scale-95"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : playing ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="ml-0.5 h-5 w-5" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref={barsRef}
          className="flex h-8 cursor-pointer items-center gap-[2px]"
          onClick={(e) => seek(e.clientX)}
          role="slider"
          tabIndex={0}
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          {shown.map((v, i) => {
            const active = i / shown.length <= progress;
            return (
              <span
                key={i}
                className={cx('w-[3px] shrink-0 rounded-full transition-colors', active ? 'bg-brand-400' : 'bg-line')}
                style={{ height: `${Math.max(12, (v / peak) * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[11px] tabular-nums text-ink-soft">
          <span>{fmtTime(total * progress)}</span>
          <span>{fmtTime(total)}</span>
        </div>
      </div>
      <button
        onClick={cycleSpeed}
        className="shrink-0 rounded-lg bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink transition hover:bg-line/70"
        title="Playback speed"
      >
        {SPEEDS[speedIdx]}x
      </button>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMetaDuration(d);
        }}
        onPlay={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
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
