# Cloak — Development Phases

Each phase stays runnable. The database schema for **all** entities exists from
Phase 1 so later phases are additive (no destructive migrations for core tables).

| Phase | Scope | Status |
|------:|-------|--------|
| **1** | Snapdeal-email auth (OTP), sessions/refresh, anonymous identity generation, profiles (read/edit), channels (core), messages (send/list/edit/delete, cursor pagination), real-time chat + presence + typing | **✅ implemented in this pass** |
| 2 | Threads, reactions + emoji picker (recent/frequent), mentions, DMs, bookmarks, pins, reports (user-facing), notifications | **✅ implemented** |
| 3 | File/image/video sharing: signed uploads, MIME/size validation, thumbnails, media player, link previews (SSRF-safe) | **✅ implemented** (local-disk store + signed URLs; thumbnails deferred) |
| 4 | Voice messages: record, waveform, playback speed, compression, max-duration | **✅ implemented** |
| 5 | Voice rooms (SFU): join/leave, mute/deafen, speaking, raise hand, per-user volume | **✅ implemented** (LiveKit SFU) |
| 6 | Video rooms: camera/mic, screen share, PiP, grid, active speaker, side chat | **✅ implemented** (LiveKit SFU) |
| 7 | Gamification: XP, levels, streaks, badges (admin-configurable), leaderboards, achievements | **✅ implemented** |
| 8 | Polls, events (RSVP), icebreakers, confessions (pre-moderated), random pairing, trivia, meme battle, watch party | **✅ core implemented** (trivia/meme/watch-party pending) |
| 9 | Moderation + admin dashboard: reports queue, mute/suspend/ban, channel ban, audit logs, **audited identity unmask**, badge/reaction/XP config | **✅ implemented** |
| 10 | Search (filters: from:/channel:/has:/after:), performance (caching, indexes, virtualization), observability, security hardening | **✅ search implemented** (perf/observability ongoing) |

## What "runnable" means at Phase 1

- `docker compose up` brings Postgres + Redis + Mailhog + MinIO.
- `npm run db:migrate && npm run db:seed` creates schema + realistic anonymous
  seed users, default channels, and sample messages.
- `npm run dev` runs API (`:4000`) and web (`:5173`).
- You can: enter a `@snapdeal.com` email → get a code (shown in Mailhog / dev log)
  → receive an auto-generated anonymous identity → chat in real time across two
  browser tabs, with presence and typing indicators — and **no** API/WS response
  reveals your email or real identity (asserted by tests).

## Definition of done per phase

- Feature works end-to-end (UI ↔ REST/WS ↔ DB).
- Privacy invariant holds (no real-identity leakage) — covered by tests.
- Authz enforced (role/membership).
- Migrations + seed updated; docs updated; tests added; lint/format clean.
