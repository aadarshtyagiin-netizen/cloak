import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../store/auth';
import { useRealtime } from '../store/realtime';
import { useNotifications } from '../store/notifications';
import { useUI } from '../store/ui';
import { notificationsApi } from './api';
import { queryClient } from './queryClient';
import { playPing, showBrowserNotification } from './notify';
import {
  applyDeletedAcrossChannels,
  applyNewDmMessage,
  applyNewMessage,
  applyPollUpdate,
  applyReactionUpdate,
  applyUpdatedAcrossChannels,
} from './messageCache';
import type { NotificationView, Presence, PublicMessage, ReactionUpdate, PollUpdate } from '../types';

const WS_BASE = import.meta.env.VITE_WS_URL ?? '';

const SocketCtx = createContext<Socket | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useSocket = (): Socket | null => useContext(SocketCtx);

export function SocketProvider({ children }: { children: ReactNode }): JSX.Element {
  const token = useAuth((s) => s.accessToken);
  const status = useAuth((s) => s.status);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (status !== 'authed' || !token) return;

    const s = io(`${WS_BASE}/rt`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    s.on('message:new', (p: { message: PublicMessage }) => applyNewMessage(p.message));
    s.on('message:updated', (p: { messageId: string; body: string; editedAt: string | null }) =>
      applyUpdatedAcrossChannels(p.messageId, p.body, p.editedAt),
    );
    s.on('message:deleted', (p: { messageId: string }) => applyDeletedAcrossChannels(p.messageId));
    s.on('presence:update', (p: { profileId: string; status: Presence }) =>
      useRealtime.getState().setPresence(p.profileId, p.status),
    );
    s.on('typing:update', (p: { channelId: string; username: string; isTyping: boolean }) =>
      useRealtime.getState().setTyping(p.channelId, p.username, p.isTyping),
    );
    s.on('reaction:update', (p: ReactionUpdate) =>
      applyReactionUpdate(p, useAuth.getState().profile?.id),
    );
    s.on('poll:update', (p: PollUpdate) => applyPollUpdate(p.messageId, p.poll));
    s.on('notification:new', (n: NotificationView) => {
      useNotifications.getState().increment();
      const ui = useUI.getState();
      const who = n.actor?.username ?? 'Cloak';
      const what =
        n.type === 'DM'
          ? 'sent you a message'
          : n.type === 'MENTION'
            ? 'mentioned you'
            : n.type === 'THREAD_REPLY'
              ? 'replied in a thread'
              : n.type === 'REACTION'
                ? `reacted ${n.payload?.emoji ?? ''}`.trim()
                : 'new activity';
      const summary = n.payload?.snippet ? `${who} ${what}: “${n.payload.snippet}”` : `${who} ${what}`;
      // Always show an in-app toast so notifications are visible while the tab is
      // focused (browser notifications only fire when the tab is hidden).
      ui.pushToast('info', summary);
      if (ui.soundEnabled) playPing();
      if (ui.browserEnabled) showBrowserNotification('Cloak', `${who} ${what}`);
    });
    s.on('dm:message', (p: { message: PublicMessage }) => {
      if (p.message.dmThreadId) applyNewDmMessage(p.message.dmThreadId, p.message);
    });

    // Reliability: after a dropped connection is restored, backfill anything we
    // may have missed while offline. The first `connect` is the initial load
    // (data is already being fetched), so only resync on genuine reconnects.
    let firstConnect = true;
    s.on('connect', () => {
      if (firstConnect) {
        firstConnect = false;
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['dm-messages'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      notificationsApi
        .unreadCount()
        .then((r) => useNotifications.getState().setUnread(r.count))
        .catch(() => undefined);
    });

    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [status, token]);

  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}
