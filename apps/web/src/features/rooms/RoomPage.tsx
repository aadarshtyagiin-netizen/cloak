import { useEffect } from 'react';
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
    <div className="flex min-h-0 flex-1 flex-col" data-lk-theme="default">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button className="text-ink-soft hover:text-ink" onClick={leave}>←</button>
        <h1 className="flex-1 text-base font-bold">{roomKind === 'video' ? '📹 Video room' : '🎧 Voice room'}</h1>
        <span className="text-[11px] text-ink-soft">Anonymous · powered by an SFU</span>
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
          <div className="flex h-full flex-col">
            <ConnectionBanner />
            <div className="min-h-0 flex-1">
              {roomKind === 'video' ? <VideoConference /> : <VoiceRoom />}
            </div>
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
    </div>
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
    <div className="flex items-center justify-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-ink-soft">
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
      {label}
    </div>
  );
}

/** Voice-room layout: speaking-highlighted avatar tiles + a minimal control bar. */
function VoiceRoom(): JSX.Element {
  const participants = useParticipants();
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  const others = participants.filter((p) => !p.isLocal).length;

  return (
    <div className="flex h-full flex-col">
      {/* Shown only if the browser blocked autoplay — one click unlocks remote audio. */}
      <StartAudio
        label="🔊 Click to enable audio"
        className="m-2 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {participants.map((p) => {
            const name = p.name || p.identity;
            return (
              <div
                key={p.sid}
                className={cx(
                  'flex flex-col items-center gap-2 rounded-xl border bg-surface-2 p-4 transition',
                  p.isSpeaking ? 'border-emerald-400 ring-2 ring-emerald-400/50' : 'border-line',
                )}
              >
                <Avatar seed={name} username={name} size="lg" presence="ONLINE" />
                <div className="flex items-center gap-1 text-sm">
                  <span className="max-w-[90px] truncate">{name}{p.isLocal ? ' (you)' : ''}</span>
                  <span>{p.isMicrophoneEnabled ? '🎤' : '🔇'}</span>
                </div>
              </div>
            );
          })}
        </div>
        {connected && others === 0 ? (
          <p className="mt-6 text-center text-sm text-ink-soft">
            You’re connected and live. Voice rooms need at least one other person — open a second
            browser (or invite a teammate) and join this same room to talk.
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
        <MicMeter />
        <ControlBar variation="minimal" controls={{ microphone: true, camera: false, screenShare: false, chat: false, leave: true }} />
      </div>
    </div>
  );
}

/** Live level meter for the local mic — gives instant "my voice is working" feedback. */
function MicMeter(): JSX.Element {
  const { microphoneTrack, isMicrophoneEnabled, lastMicrophoneError } = useLocalParticipant();
  const volume = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);
  const pct = isMicrophoneEnabled ? Math.min(100, Math.round(volume * 160)) : 0;

  if (lastMicrophoneError) {
    return <span className="text-xs text-rose-400">🔇 Mic blocked — allow microphone access</span>;
  }
  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft" title="Local microphone level">
      <span>{isMicrophoneEnabled ? '🎤' : '🔇'}</span>
      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-400 transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="hidden sm:inline">{isMicrophoneEnabled ? 'Mic live' : 'Muted'}</span>
    </div>
  );
}
