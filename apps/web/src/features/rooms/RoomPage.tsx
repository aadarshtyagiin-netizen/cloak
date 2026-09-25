import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import '@livekit/components-styles';
import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoConference,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useTrackVolume,
} from '@livekit/components-react';
import { ConnectionState, type LocalAudioTrack } from 'livekit-client';
import type { KrispNoiseFilterProcessor } from '@livekit/krisp-noise-filter';
import {
  ChevronLeft,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ApiError, roomsApi } from '../../lib/api';
import { useUI } from '../../store/ui';
import { Avatar, EmptyState, Spinner, cx } from '../../components/ui';
import type { RoomKind } from '../../types';

export function RoomPage(): JSX.Element {
  const { kind = 'voice', id = '' } = useParams<{ kind: RoomKind; id: string }>();
  const roomKind = (kind === 'video' ? 'video' : 'voice') as RoomKind;
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);

  const { data, isLoading, error } = useQuery({
    queryKey: ['room-token', roomKind, id],
    queryFn: () => roomsApi.token(roomKind, id),
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Persist leave when navigating away.
  useEffect(() => {
    return () => {
      void roomsApi.leave(roomKind, id).catch(() => undefined);
    };
  }, [roomKind, id]);

  function leave(): void {
    navigate(`/rooms/${roomKind}`);
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-soft">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        icon="🎛️"
        title="Couldn't connect to the room"
        hint={
          error instanceof ApiError
            ? error.message
            : 'The realtime server (LiveKit) may be offline. Run `npm run infra:up`.'
        }
        action={<button className="btn-subtle" onClick={leave}>← Back to rooms</button>}
      />
    );
  }

  return (
    // `dark` forces the call surface to stay dark in BOTH app themes (like
    // Discord), which also keeps LiveKit's white-on-dark UI readable.
    <div className="dark flex min-h-0 flex-1 flex-col bg-surface-4 text-ink" data-lk-theme="default">
      <header className="flex items-center gap-3 border-b border-line/60 bg-surface-2/60 px-4 py-3 backdrop-blur">
        <button className="chrome-btn -ml-1" onClick={leave} aria-label="Back to rooms" title="Back to rooms">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span
          className={cx(
            'flex h-9 w-9 items-center justify-center rounded-xl',
            roomKind === 'video' ? 'bg-brand-500/15 text-accent' : 'bg-positive/15 text-positive',
          )}
        >
          {roomKind === 'video' ? <Video className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight">
            {data.roomName || (roomKind === 'video' ? 'Video room' : 'Voice room')}
          </h1>
          <p className="text-[11px] text-ink-soft">Anonymous · end-to-end via SFU</p>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <LiveKitRoom
          serverUrl={data.url}
          token={data.token}
          connect
          audio
          video={roomKind === 'video'}
          options={{
            // Reduce "hot mic" / background-noise pickup by explicitly enabling the
            // browser's audio processing on the captured microphone. Without this the
            // mic can transmit keyboard/ambient noise and feel overly sensitive.
            audioCaptureDefaults: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }}
          onDisconnected={leave}
          onError={(e) =>
            pushToast('error', e?.message ? `Room error: ${e.message}` : 'Lost connection to the room.')
          }
          style={{ height: '100%' }}
        >
          <RoomSession roomKind={roomKind} />
        </LiveKitRoom>
      </div>
    </div>
  );
}

/**
 * Holds the shared deafen state and renders the room UI. Deafen mutes ALL
 * incoming audio (RoomAudioRenderer volume→0) and your own mic, Discord-style.
 */
function RoomSession({ roomKind }: { roomKind: RoomKind }): JSX.Element {
  const [deafened, setDeafened] = useState(false);
  return (
    <>
      <div className="flex h-full flex-col">
        <ConnectionBanner />
        <div className="min-h-0 flex-1">
          {roomKind === 'video' ? <VideoConference /> : <VoiceRoom deafened={deafened} setDeafened={setDeafened} />}
        </div>
      </div>
      <RoomAudioRenderer volume={deafened ? 0 : 1} />
    </>
  );
}

/** A slim status strip shown whenever the media session isn't fully connected. */
function ConnectionBanner(): JSX.Element | null {
  const state = useConnectionState();
  if (state === ConnectionState.Connected) return null;
  const label =
    state === ConnectionState.Connecting
      ? 'Connecting to the room…'
      : state === ConnectionState.Reconnecting
        ? 'Connection dropped — reconnecting…'
        : state === ConnectionState.Disconnected
          ? 'Disconnected'
          : 'Connecting…';
  return (
    <div className="flex items-center justify-center gap-2 border-b border-line/60 bg-warning/10 px-4 py-1.5 text-xs font-medium text-warning">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

/** Voice-room layout: speaking-highlighted avatar tiles + a minimal control bar. */
function VoiceRoom({ deafened, setDeafened }: { deafened: boolean; setDeafened: (v: boolean) => void }): JSX.Element {
  const participants = useParticipants();
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  const others = participants.filter((p) => !p.isLocal).length;

  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const micBeforeDeafen = useRef(true);

  async function toggleDeafen(): Promise<void> {
    if (!deafened) {
      // Deafen: remember mic state, silence it and all incoming audio.
      micBeforeDeafen.current = isMicrophoneEnabled;
      try {
        await localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* ignore */
      }
      setDeafened(true);
    } else {
      // Undeafen: restore audio and the mic to how it was.
      setDeafened(false);
      try {
        await localParticipant.setMicrophoneEnabled(micBeforeDeafen.current);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Shown only if the browser blocked autoplay — one click unlocks remote audio. */}
      <StartAudio
        label="🔊 Click to enable audio"
        className="m-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-warning"
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
          <span className="inline-flex h-2 w-2 rounded-full bg-positive" />
          {connected ? `In voice — ${participants.length} ${participants.length === 1 ? 'person' : 'people'}` : 'Connecting'}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {participants.map((p) => {
            const name = p.name || p.identity;
            const muted = !p.isMicrophoneEnabled;
            return (
              <div
                key={p.sid}
                className={cx(
                  'group relative flex flex-col items-center gap-3 rounded-2xl border bg-surface-2/80 p-5 transition',
                  p.isSpeaking
                    ? 'border-positive/70 ring-2 ring-positive/40'
                    : 'border-line/70 hover:border-line',
                )}
              >
                <div className={cx('rounded-full', p.isSpeaking && 'animate-speaking-ring')}>
                  <Avatar seed={name} username={name} size="xl" />
                </div>
                <div className="flex max-w-full items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink">
                    {name}
                    {p.isLocal ? ' (you)' : ''}
                  </span>
                  {muted ? (
                    <MicOff className="h-3.5 w-3.5 shrink-0 text-danger" />
                  ) : (
                    <Mic className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {connected && others === 0 ? (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-line/70 bg-surface-2/60 p-5 text-center">
            <p className="text-sm text-ink-soft">
              You're connected and live. Voice rooms need at least one other person — open a second
              browser (or invite a teammate) and join this same room to talk.
            </p>
          </div>
        ) : null}
      </div>
      {/* Controls: mic level on the left; mic/deafen/leave grouped on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 bg-surface-4/80 px-4 py-3 backdrop-blur">
        <MicMeter />
        <div className="flex items-center gap-2">
          <NoiseFilterToggle />
          <button
            onClick={() => void toggleDeafen()}
            title={deafened ? 'Undeafen — restore audio and your mic' : 'Deafen — mute everyone and your mic'}
            className={cx(
              'flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition',
              deafened
                ? 'bg-danger/15 text-danger ring-1 ring-danger/40'
                : 'bg-surface-3 text-ink hover:bg-line/70',
            )}
          >
            {deafened ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {deafened ? 'Deafened' : 'Deafen'}
          </button>
          <ControlBar
            variation="minimal"
            controls={{ microphone: true, camera: false, screenShare: false, chat: false, leave: true }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Voice-sensitivity control: toggles LiveKit's client-side Krisp noise filter on
 * the local mic to strip background noise (keyboard, fan, chatter). Best-effort —
 * hidden when unsupported, and any failure silently falls back to the browser's
 * built-in noise suppression without breaking the microphone.
 */
function NoiseFilterToggle(): JSX.Element | null {
  const { microphoneTrack } = useLocalParticipant();
  // Cheap capability check so we can show the button without pulling the heavy
  // Krisp model. The real (more precise) check + model load happen lazily on enable.
  const [supported] = useState(() => {
    try {
      return typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';
    } catch {
      return false;
    }
  });
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const processorRef = useRef<KrispNoiseFilterProcessor | null>(null);
  const track = (microphoneTrack?.track ?? undefined) as LocalAudioTrack | undefined;

  useEffect(() => {
    let active = true;
    async function apply(): Promise<void> {
      if (!track) return;
      try {
        if (on) {
          if (!processorRef.current) {
            setLoading(true);
            // Lazy-loaded so the ~MB Krisp model is only fetched when the user
            // turns the filter on (keeps the room page light for everyone else).
            const mod = await import('@livekit/krisp-noise-filter');
            if (!active) return;
            if (!mod.isKrispNoiseFilterSupported()) {
              setOn(false);
              return;
            }
            processorRef.current = mod.KrispNoiseFilter();
            await track.setProcessor(processorRef.current);
          }
          if (active) await processorRef.current.setEnabled(true);
        } else if (processorRef.current) {
          await processorRef.current.setEnabled(false);
        }
      } catch {
        /* fall back to the browser's built-in noise suppression */
      } finally {
        if (active) setLoading(false);
      }
    }
    void apply();
    return () => {
      active = false;
    };
  }, [on, track]);

  // Tear down the processor when leaving the room.
  useEffect(() => {
    return () => {
      const p = processorRef.current;
      processorRef.current = null;
      if (p) void p.destroy().catch(() => undefined);
    };
  }, []);

  if (!supported) return null;
  return (
    <button
      onClick={() => setOn((v) => !v)}
      disabled={loading}
      title={on ? 'Background-noise filter is ON' : 'Reduce background noise'}
      className={cx(
        'flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60',
        on
          ? 'bg-positive/15 text-positive ring-1 ring-positive/40'
          : 'bg-surface-3 text-ink hover:bg-line/70',
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      <span className="hidden sm:inline">{on ? 'Noise filter on' : 'Reduce noise'}</span>
    </button>
  );
}

/** Live level meter for the local mic — gives instant "my voice is working" feedback. */
function MicMeter(): JSX.Element {
  const { microphoneTrack, isMicrophoneEnabled, lastMicrophoneError } = useLocalParticipant();
  const volume = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const pct = isMicrophoneEnabled ? Math.min(100, Math.round(volume * 160)) : 0;

  if (lastMicrophoneError) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
        <MicOff className="h-4 w-4" /> Mic blocked — allow microphone access
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft" title="Local microphone level">
      {isMicrophoneEnabled ? <Mic className="h-4 w-4 text-ink" /> : <MicOff className="h-4 w-4" />}
      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-positive transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="hidden sm:inline">{isMicrophoneEnabled ? 'Mic live' : 'Muted'}</span>
    </div>
  );
}
