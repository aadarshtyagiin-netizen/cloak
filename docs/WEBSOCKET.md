# Cloak — Real-time (WebSocket) Event Specification

Transport: **Socket.IO** (WebSocket first, long-poll fallback). One namespace
`/rt`. Horizontal scale via the **Redis adapter** (fan-out across nodes).

## Handshake / auth

```
io("/rt", { auth: { token: "<accessJWT>" } })
```

- The gateway verifies the JWT **before** the connection is accepted. Invalid or
  expired → `connect_error` with `{ code: "UNAUTHENTICATED" }`.
- On connect the socket auto-joins its **personal room** `user:{profileId}` (for
  notifications, presence sync, and DM delivery across devices).
- The socket identity is the **anonymous profile**. `authUserId`/email are never
  attached to the socket or any payload.

## Rooms

| Room                 | Purpose |
|----------------------|---------|
| `user:{profileId}`   | Personal — notifications, cross-device sync |
| `channel:{channelId}`| Channel chat, typing, presence within channel |
| `dm:{threadId}`      | Direct-message thread |
| `voice:{roomId}` / `video:{roomId}` | Signaling coordination (phases 5–6) |

## Client → Server events

| Event                | Payload                              | Notes |
|----------------------|--------------------------------------|-------|
| `channel:join`       | `{ channelId }`                      | Authz-checked; joins `channel:{id}` |
| `channel:leave`      | `{ channelId }`                      | |
| `message:send`       | `{ channelId, body, parentId?, clientNonce }` | Also accepted via REST; server assigns id, echoes with `clientNonce` for optimistic UI |
| `typing:start`       | `{ channelId }`                      | **Ephemeral, never persisted** |
| `typing:stop`        | `{ channelId }`                      | |
| `presence:update`    | `{ status }` (online/away/dnd/invisible) | Heartbeat refreshes Redis TTL |
| `message:read`       | `{ channelId, lastMessageId }`       | Debounced read-receipt (batched) |

All C→S events support an **ack callback** `(err, result)` for delivery
confirmation (`✓ Sent`).

## Server → Client events

| Event                 | Payload                                                    |
|-----------------------|------------------------------------------------------------|
| `message:new`         | `{ message }` (anonymous author + reactions)               |
| `message:updated`     | `{ messageId, body, editedAt }`                            |
| `message:deleted`     | `{ messageId }`                                            |
| `reaction:updated`    | `{ messageId, emoji, count, reactedByMe }` *(Phase 2)*     |
| `typing:update`       | `{ channelId, username, isTyping }`                        |
| `presence:update`     | `{ profileId, username, status, lastSeen }`                |
| `channel:member`      | `{ channelId, event: "join"\|"leave", profile }`           |
| `notification:new`    | `{ notification }` *(Phase 2+)*                             |
| `delivery:state`      | `{ messageId, state: "sent"\|"delivered"\|"read" }`        |
| `error`               | `{ code, message }`                                        |

## Delivery states & read receipts (scale)

- `sent` → server persisted (ack to sender).
- `delivered` → at least one recipient socket in the room received it.
- `read` → recipient emitted `message:read`. For channels, read receipts are
  **aggregated** (store only each member's `lastReadMessageId`, not a row per
  message per member) to avoid write amplification.

## Presence model

- `presence:{profileId}` in Redis with TTL (e.g. 30s), refreshed by heartbeat.
- Status values: `online 🟢`, `away 🟡`, `dnd 🔴`, `offline ⚫`.
- `invisible` lets a user disable their online status — the server stores real
  status privately but broadcasts `offline`.

## Typing (privacy + scale)

- Broadcast to `channel:{id}` excluding sender; auto-expire client-side after ~4s.
- Never written to Postgres. Carries only the anonymous `username`.

## Backpressure & abuse

- Per-socket rate limits on `message:send` / `typing:*`.
- Oversized payloads rejected. Server validates channel membership on every
  room-scoped event (a socket cannot publish to a channel it hasn't joined).
