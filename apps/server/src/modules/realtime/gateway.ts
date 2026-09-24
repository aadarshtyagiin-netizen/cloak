import type { Server, Socket } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { verifyAccessToken, type AuthIdentity } from '../../lib/tokens.js';
import { channelsService } from '../channels/channels.service.js';
import { messagesService } from '../messages/messages.service.js';
import { clearPresence, refreshPresence, setPresence, type PresenceValue } from './presence.js';
import { type RealtimeGateway, setRealtime } from './emit.js';

export { createNoopRealtime, type RealtimeGateway } from './emit.js';

interface SocketState {
  identity: AuthIdentity;
  username: string;
  presenceVisible: boolean;
}

type Ack = ((res: { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string } }) => void) | undefined;

const channelRoom = (channelId: string) => `channel:${channelId}`;
const userRoom = (profileId: string) => `user:${profileId}`;

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL', message: 'Something went wrong.' };
}

function state(socket: Socket): SocketState {
  return socket.data as SocketState;
}

/** Build the compact identity object we broadcast (anonymous only). */
function selfCard(s: SocketState) {
  return { id: s.identity.profileId, username: s.username };
}

/**
 * Wire up the Socket.IO gateway: authenticate the handshake, join rooms, relay
 * chat/typing/presence, and expose emit helpers for the HTTP layer.
 */
export function createRealtime(io: Server): RealtimeGateway {
  const nsp = io.of('/rt');

  // Verify the access token BEFORE the connection is accepted.
  nsp.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) return next(new Error('UNAUTHENTICATED'));
      const identity = await verifyAccessToken(token);
      const profile = await prisma.anonymousProfile.findUnique({
        where: { id: identity.profileId },
        select: { username: true, presenceVisible: true },
      });
      if (!profile) return next(new Error('UNAUTHENTICATED'));
      socket.data = {
        identity,
        username: profile.username,
        presenceVisible: profile.presenceVisible,
      } satisfies SocketState;
      return next();
    } catch {
      return next(new Error('UNAUTHENTICATED'));
    }
  });

  const effectiveStatus = (s: SocketState, desired: PresenceValue): PresenceValue =>
    s.presenceVisible && desired !== 'INVISIBLE' ? desired : 'OFFLINE';

  function broadcastPresence(socket: Socket, status: PresenceValue): void {
    const s = state(socket);
    const payload = { profileId: s.identity.profileId, username: s.username, status };
    for (const room of socket.rooms) {
      if (room.startsWith('channel:')) socket.to(room).emit('presence:update', payload);
    }
  }

  nsp.on('connection', (socket) => {
    const s = state(socket);
    socket.join(userRoom(s.identity.profileId));
    void setPresence(s.identity.profileId, effectiveStatus(s, 'ONLINE'));

    socket.on('channel:join', async (payload: { channelId?: string }, ack: Ack) => {
      try {
        const channelId = payload?.channelId;
        if (!channelId) throw AppError.notFound('Channel');
        await channelsService.assertChannelAccess(channelId, s.identity.profileId);
        await socket.join(channelRoom(channelId));
        void refreshPresence(s.identity.profileId);
        socket
          .to(channelRoom(channelId))
          .emit('channel:member', { channelId, event: 'join', profile: selfCard(s) });
        // Tell the joiner this member is present.
        socket.to(channelRoom(channelId)).emit('presence:update', {
          profileId: s.identity.profileId,
          username: s.username,
          status: effectiveStatus(s, 'ONLINE'),
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: toError(err) });
      }
    });

    socket.on('channel:leave', (payload: { channelId?: string }) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      socket
        .to(channelRoom(channelId))
        .emit('channel:member', { channelId, event: 'leave', profile: selfCard(s) });
      void socket.leave(channelRoom(channelId));
    });

    // Typing is EPHEMERAL — broadcast to the room, never persisted.
    socket.on('typing:start', (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      socket.to(channelRoom(payload.channelId)).emit('typing:update', {
        channelId: payload.channelId,
        username: s.username,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      socket.to(channelRoom(payload.channelId)).emit('typing:update', {
        channelId: payload.channelId,
        username: s.username,
        isTyping: false,
      });
    });

    // Optional send-over-socket path (REST is the primary path). Same service,
    // echoes clientNonce so the sender can reconcile its optimistic message.
    socket.on(
      'message:send',
      async (
        payload: { channelId?: string; body?: string; parentId?: string; clientNonce?: string },
        ack: Ack,
      ) => {
        try {
          if (!payload?.channelId || !payload.body) throw AppError.notFound('Message');
          const message = await messagesService.sendChannelMessage(
            payload.channelId,
            s.identity.profileId,
            { body: payload.body, parentId: payload.parentId },
          );
          nsp.to(channelRoom(payload.channelId)).emit('message:new', { message });
          void refreshPresence(s.identity.profileId);
          ack?.({ ok: true, message, clientNonce: payload.clientNonce });
        } catch (err) {
          ack?.({ ok: false, error: toError(err) });
        }
      },
    );

    // Aggregated read receipt: store only lastReadMessageId per member.
    socket.on('message:read', async (payload: { channelId?: string; lastMessageId?: string }) => {
      if (!payload?.channelId || !payload.lastMessageId) return;
      try {
        await prisma.channelMember.updateMany({
          where: { channelId: payload.channelId, profileId: s.identity.profileId },
          data: { lastReadMessageId: payload.lastMessageId },
        });
      } catch {
        /* best-effort */
      }
    });

    socket.on('presence:update', (payload: { status?: PresenceValue }) => {
      const desired = payload?.status ?? 'ONLINE';
      const status = effectiveStatus(s, desired);
      void setPresence(s.identity.profileId, status);
      broadcastPresence(socket, status);
    });

    socket.on('disconnecting', () => {
      broadcastPresence(socket, 'OFFLINE');
      void clearPresence(s.identity.profileId);
    });
  });

  logger.info('realtime gateway attached');

  const gateway: RealtimeGateway = {
    emitMessageNew: (channelId, message) => {
      nsp.to(channelRoom(channelId)).emit('message:new', { message });
    },
    emitMessageUpdated: (channelId, message) => {
      nsp.to(channelRoom(channelId)).emit('message:updated', {
        messageId: message.id,
        body: message.body,
        editedAt: message.editedAt,
      });
    },
    emitMessageDeleted: (channelId, messageId) => {
      nsp.to(channelRoom(channelId)).emit('message:deleted', { messageId });
    },
    emitReactionUpdate: (channelId, payload) => {
      nsp.to(channelRoom(channelId)).emit('reaction:update', payload);
    },
    emitPollUpdate: (channelId, payload) => {
      nsp.to(channelRoom(channelId)).emit('poll:update', payload);
    },
    emitNotification: (recipientProfileId, notification) => {
      nsp.to(userRoom(recipientProfileId)).emit('notification:new', notification);
    },
    emitDmMessage: (recipientProfileIds, message) => {
      for (const id of recipientProfileIds) {
        nsp.to(userRoom(id)).emit('dm:message', { message });
      }
    },
  };

  setRealtime(gateway);
  return gateway;
}
