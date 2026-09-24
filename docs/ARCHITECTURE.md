# Cloak — Architecture

> **Guiding principle:** *Anonymous to the community, accountable to the platform.*
> A normal user only ever sees `🐼 PixelPanda81`. The backend knows
> `Snapdeal account → internal user id → PixelPanda81`, but that mapping is
> **never** exposed through any ordinary API.

---

## 1. High-level architecture

```
                                   ┌──────────────────────────────────────────┐
                                   │                Clients                    │
                                   │  Web (React/Vite)   Mobile-web (responsive)│
                                   └───────────────┬───────────────┬───────────┘
                                        HTTPS/REST │      WSS       │ WebRTC (later)
                                                   │  (Socket.IO)   │
                          ┌────────────────────────▼────────────────▼────────────────────┐
                          │                     Edge / API Gateway                        │
                          │   TLS termination · CORS · global rate limit · WAF · CDN      │
                          └───────────────────────────────┬──────────────────────────────┘
                                                           │
              ┌────────────────────────────────────────────────────────────────────────────────┐
              │                        Cloak API (modular monolith, Fastify)                     │
              │                                                                                   │
              │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │
              │  │  Auth  │ │ Identity │ │ Profiles │ │ Channels │ │ Messaging │ │   Media    │  │
              │  └────────┘ └──────────┘ └──────────┘ └──────────┘ └───────────┘ └────────────┘  │
              │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │
              │  │ Voice  │ │  Video   │ │  Notifs  │ │  Search  │ │ Moderation│ │Gamification│  │
              │  └────────┘ └──────────┘ └──────────┘ └──────────┘ └───────────┘ └────────────┘  │
              │                                                                                   │
              │  Cross-cutting: authn/authz guards · request validation · idempotency ·          │
              │  structured logging · error mapping · audit logging · anonymization boundary      │
              └───┬──────────────┬───────────────┬──────────────┬───────────────┬────────────────┘
                  │              │               │              │               │
          ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼───────────┐
          │ PostgreSQL   │ │   Redis    │ │  Object    │ │  Realtime   │ │  Media SFU       │
          │ (source of   │ │ cache /    │ │  storage   │ │  Pub/Sub    │ │ (mediasoup/LK,   │
          │  truth)      │ │ presence / │ │ (S3/MinIO) │ │ (Redis      │ │  voice/video —   │
          │              │ │ rate limit │ │ signed URLs│ │  adapter)   │ │  phases 5–6)     │
          └──────────────┘ └────────────┘ └────────────┘ └─────────────┘ └──────────────────┘
                  │
          ┌───────▼───────────────┐
          │ Background workers      │  email delivery · thumbnails/transcode · link-preview
          │ (BullMQ on Redis)       │  fetch · notification fan-out · spam/abuse scoring · XP
          └─────────────────────────┘
```

### Why a modular monolith (not microservices) now

The requirements demand **clear service boundaries**, not physically separate
services. We get the boundaries via **modules with explicit public interfaces**
and keep a single deployable so Phase 1 stays runnable and cheap to operate.
Each module (`auth`, `identity`, `messaging`, …) owns its routes, service layer,
and data access, and talks to other modules only through their service classes —
never by reaching into another module's tables directly. Any module can later be
extracted into its own service because the seam already exists.

This is a deliberate application of the *deep module* idea: a small public
interface (the service class) over a larger private implementation.

---

## 2. Module boundaries (bounded contexts)

| Module        | Responsibility                                                            | Owns tables                                             |
|---------------|---------------------------------------------------------------------------|---------------------------------------------------------|
| `auth`        | Snapdeal email verification, sessions, tokens, brute-force protection     | `AuthUser`, `Session`, `EmailVerification`              |
| `identity`    | Anonymous username/avatar generation + uniqueness + regeneration rules    | (reads `AuthUser`, writes `AnonymousProfile`)           |
| `profiles`    | Public anonymous profile (bio, badges, karma, stats)                      | `AnonymousProfile`, `UserBadge`                         |
| `channels`    | Channel lifecycle, membership, permissions, pins                          | `Channel`, `ChannelMember`                              |
| `messaging`   | Messages, threads, reactions, edits, delivery states, DMs                 | `Message`, `Thread`, `Reaction`, `DirectMessage`        |
| `media`       | Uploads, MIME/size validation, thumbnails, signed URLs                    | `Attachment`, `VoiceMessage`                            |
| `voice`       | Voice rooms (SFU signaling), participants                                 | `VoiceRoom`, `VoiceRoomParticipant`                     |
| `video`       | Video rooms, screen share, active-speaker                                 | `VideoRoom`, `VideoRoomParticipant`                     |
| `notifications`| Preference-aware notification fan-out + delivery                         | `Notification`, `NotificationPreference`                |
| `search`      | Message/user/channel search, filters, indexing                            | (read models / Postgres FTS)                            |
| `moderation`  | Reports, blocks, mutes, bans, suspensions, audit, identity unmasking      | `Report`, `Block`, `ModerationAction`, `AuditLog`       |
| `gamification`| XP, levels, streaks, badges, leaderboards, achievements                   | `XPEvent`, `Badge`, `Streak`, `Achievement`             |
| `community`   | Polls, events, icebreakers, confessions, random pairing, trivia          | `Poll`, `PollVote`, `Event`, `Icebreaker`, …            |
| `realtime`    | Socket.IO gateway: auth handshake, room fan-out, presence, typing         | (Redis only; no SQL ownership)                          |

**Phase 1 implements:** `auth`, `identity`, `profiles` (read), `channels`
(core), `messaging` (core), `realtime` (chat/presence/typing). Every other
module has its schema defined and a documented contract so later phases are
additive.

---

## 3. Real-time layer

- **Chat / presence / typing / notifications** → **Socket.IO over WebSocket**.
  - JWT is verified in the handshake (`auth.token`); unauthenticated sockets are
    rejected before joining any room.
  - Server-side rooms map to `channel:{id}`, `dm:{threadId}`, `user:{profileId}`
    (personal room for notifications and cross-device sync).
  - Horizontal scale via the **Redis adapter**: any node can publish to a room and
    every node with subscribers delivers it — this is the message **fan-out**, and
    it replaces polling entirely.
- **Voice / video** (phases 5–6) → **WebRTC via an SFU** (mediasoup or LiveKit).
  The API server is only the **signaling + auth** plane; media never transits it.
  Anonymous identities are attached to media tracks; real identity is never sent.

### Presence & typing (privacy + scale)

- Presence lives in **Redis** as `presence:{profileId} = {status, lastSeen}` with a
  short TTL refreshed by heartbeats. Offline is inferred from TTL expiry — no DB
  writes on every heartbeat.
- Typing events are **ephemeral**: broadcast to the room and never persisted
  (explicit requirement). They carry only the anonymous username.

---

## 4. Media pipeline

1. Client requests a **pre-signed upload URL** (`POST /v1/media/uploads`) after the
   server validates declared MIME + size against per-type limits.
2. Client uploads directly to object storage (S3/MinIO) — bytes never touch the API.
3. A **worker** validates the *actual* content (magic-byte sniff), rejects
   executables, generates thumbnails / transcodes, and marks the `Attachment` ready.
4. Private media is served through **short-lived signed URLs**; downloads for voice
   messages are disabled by default.

---

## 5. Technology choices & rationale

| Concern            | Choice                                   | Why |
|--------------------|------------------------------------------|-----|
| Language           | **TypeScript** (server + web)            | One language, shared types for API/WS contracts, strong safety. |
| HTTP framework     | **Fastify**                              | Fast, schema-first validation (JSON Schema), first-class plugin encapsulation that mirrors our module boundaries. |
| ORM / migrations   | **Prisma + PostgreSQL**                  | Type-safe queries kill whole classes of injection bugs; declarative schema + generated migrations fit the "proper relational schema" requirement. |
| Realtime           | **Socket.IO + Redis adapter**            | Battle-tested rooms/ack/reconnect; Redis adapter gives horizontal fan-out without polling. |
| Cache/presence/queue| **Redis + BullMQ**                      | One dependency covers caching, presence TTLs, rate-limit counters, and background jobs. |
| Object storage     | **S3-compatible (MinIO locally)**        | Signed URLs, CDN-frontable, keeps large media off the app tier. |
| Voice/Video        | **WebRTC SFU (mediasoup/LiveKit)**       | SFU scales to many participants far better than mesh; app stays signaling-only. |
| Auth tokens        | **JWT access + rotating refresh (httpOnly cookie)** | Stateless fast-path auth; refresh rotation + server-side `Session` allows revocation and device management. |
| Frontend           | **React + Vite + Tailwind + Zustand + TanStack Query** | Fast DX, small state core, cache/invalidation for REST, utility CSS for a polished bespoke UI. |
| Email (dev/prod)   | **Provider interface** (Mailhog dev / SES/SMTP prod) | Swappable transport; local dev needs no real credentials. |
| Tests              | **Vitest** (unit/integration) + **Playwright** (e2e, later) | Fast TS-native runner; Playwright for real browser flows. |

---

## 6. Request lifecycle (REST)

```
request → TLS/CORS → global rate limit → route JSON-Schema validation
       → auth guard (verify access JWT) → authz guard (role/membership)
       → idempotency check (mutations) → handler → service (module)
       → Prisma (parameterized) → response mapper (ANONYMIZATION BOUNDARY)
       → structured log (no PII) → client
```

The **anonymization boundary** is a single response-mapper layer: services may
load rows that contain `authUserId`, but the mapper is the only place allowed to
build client DTOs, and it physically cannot emit `email`, `realName`, `employeeId`,
or `authUserId`. Tests assert this (see `docs/SECURITY.md`).

---

## 7. Deployment topology (target)

- Stateless API replicas behind a load balancer (sticky not required thanks to the
  Redis adapter).
- PostgreSQL primary + read replicas; PgBouncer for connection pooling.
- Redis (cluster/replica) for cache, presence, queues, and the Socket.IO adapter.
- Object storage + CDN for media.
- SFU nodes autoscaled independently for voice/video.
- Workers scaled by queue depth.
