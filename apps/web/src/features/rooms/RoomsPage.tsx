import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, roomsApi } from '../../lib/api';
import { useUI } from '../../store/ui';
import { Avatar, EmptyState, Spinner } from '../../components/ui';
import { useShell } from '../chat/AppShell';
import type { RoomKind } from '../../types';

function fmtDuration(sec: number | null): string {
  if (sec == null) return 'unknown length';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'recently';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function RoomsPage(): JSX.Element {
  const { kind = 'voice' } = useParams<{ kind: RoomKind }>();
  const roomKind = (kind === 'video' ? 'video' : 'voice') as RoomKind;
  const { openSidebar } = useShell();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [name, setName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['rooms', roomKind],
    queryFn: () => roomsApi.list(roomKind),
    refetchInterval: 5000,
  });
  const rooms = data?.data ?? [];

  const { data: historyData } = useQuery({
    queryKey: ['rooms-history', roomKind],
    queryFn: () => roomsApi.history(roomKind),
    staleTime: 30_000,
  });
  const history = historyData?.data ?? [];

  const create = useMutation({
    mutationFn: () => roomsApi.create(roomKind, name.trim() || `${roomKind} room`),
    onSuccess: (res) => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['rooms', roomKind] });
      navigate(`/rooms/${roomKind}/${res.room.id}`);
    },
    onError: (err) => pushToast('error', err instanceof ApiError ? err.message : 'Could not create room.'),
  });

  const label = roomKind === 'video' ? 'Video rooms' : 'Voice rooms';
  const icon = roomKind === 'video' ? '📹' : '🎧';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <button className="mb-4 text-sm text-ink-soft hover:text-ink md:hidden" onClick={openSidebar}>☰ Menu</button>
        <h1 className="mb-1 text-xl font-extrabold">{icon} {label}</h1>
        <p className="mb-4 text-sm text-ink-soft">
          Drop into a live {roomKind} room. Everyone is anonymous — only handles are shown.
        </p>

        <div className="mb-6 flex gap-2">
          <input
            className="input py-2 text-sm"
            placeholder={`Name your ${roomKind} room…`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create.mutate()}
          />
          <button className="btn-primary whitespace-nowrap" onClick={() => create.mutate()} disabled={create.isPending}>
            + New room
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10 text-ink-soft"><Spinner /></div>
        ) : rooms.length === 0 ? (
          <EmptyState icon={icon} title={`No active ${roomKind} rooms`} hint="Create one and invite the channel to hop in." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(`/rooms/${roomKind}/${r.id}`)}
                className="card p-4 text-left transition hover:border-brand-500 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-ink-soft">👥 {r.participants.length}</span>
                </div>
                <div className="mt-3 flex -space-x-2">
                  {r.participants.slice(0, 6).map((p) => (
                    <div key={p.profile.id} className="ring-2 ring-surface-2 rounded-full">
                      <Avatar seed={p.profile.avatarSeed} username={p.profile.username} size="sm" />
                    </div>
                  ))}
                  {r.participants.length === 0 ? <span className="text-xs text-ink-soft">Empty — be the first in</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}

        {history.length > 0 ? (
          <div className="mt-8">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Recent {roomKind} rooms</h2>
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="card flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="truncate font-semibold">{h.name}</span>
                      <span className="text-xs text-ink-soft">· was live {fmtDuration(h.durationSec)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {h.participantCount} {h.participantCount === 1 ? 'person' : 'people'} · ended {fmtWhen(h.endedAt)}
                    </div>
                  </div>
                  {h.participants.length > 0 ? (
                    <div className="flex shrink-0 -space-x-2">
                      {h.participants.slice(0, 5).map((p) => (
                        <div key={p.profile.id} className="rounded-full ring-2 ring-surface-2">
                          <Avatar seed={p.profile.avatarSeed} username={p.profile.username} size="sm" />
                        </div>
                      ))}
                      {h.participantCount > 5 ? (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold ring-2 ring-surface-2">
                          +{h.participantCount - 5}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
