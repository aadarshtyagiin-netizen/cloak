# Cloak — REST API Specification

## Conventions

- Base path: **`/v1`** (URL versioning).
- JSON only. `Content-Type: application/json` unless uploading.
- **Auth:** `Authorization: Bearer <accessJWT>`. Refresh token is an httpOnly,
  Secure, SameSite=strict cookie (`cloak_rt`), never readable by JS.
- **Errors** use a single envelope:
  ```json
  { "error": { "code": "UNAUTHORIZED_DOMAIN", "message": "Human readable", "details": {} } }
  ```
- **Pagination:** cursor-based for feeds/chat:
  `GET ...?limit=50&cursor=<opaque>` → `{ "data": [...], "nextCursor": "..." | null }`.
- **Idempotency:** mutating POSTs accept `Idempotency-Key` header; the server
  dedupes for 24h (used for message send, upload init, votes).
- **Rate limits:** per-IP + per-user token buckets; `429` returns
  `Retry-After`. Auth endpoints have stricter buckets.
- **The response mapper never emits** `email`, `emailNormalized`, `realName`,
  `employeeId`, `authUserId`, `ip`, or `codeHash`.

### Error codes (Phase 1)

| Code                      | HTTP | Meaning |
|---------------------------|------|---------|
| `INVALID_EMAIL`           | 400  | Malformed email |
| `UNAUTHORIZED_DOMAIN`     | 403  | Not a Snapdeal address |
| `INVALID_CODE`            | 400  | Wrong verification code |
| `CODE_EXPIRED`            | 400  | Verification code expired |
| `TOO_MANY_ATTEMPTS`       | 429  | Brute-force lockout / rate limit |
| `SESSION_EXPIRED`         | 401  | Access/refresh expired |
| `UNAUTHENTICATED`         | 401  | Missing/invalid token |
| `FORBIDDEN`               | 403  | Authz failure (role/membership) |
| `USERNAME_TAKEN`          | 409  | Anonymous username collision |
| `NOT_FOUND`               | 404  | Resource missing |
| `VALIDATION_ERROR`        | 422  | Body/query failed schema |
| `RATE_LIMITED`            | 429  | Generic rate limit |

---

## Auth (`/v1/auth`)  — Phase 1 ✅

| Method | Path                     | Body / notes | Response |
|--------|--------------------------|--------------|----------|
| POST   | `/request-code`          | `{ email }` — must be `@snapdeal.com` (configurable). Rate-limited per email+IP. | `202 { challengeId, expiresInSec }` (never reveals if the account exists beyond domain check) |
| POST   | `/verify-code`           | `{ challengeId, code }` — max N attempts. On success provisions profile on first login. | `200 { accessToken, expiresIn, profile }` + sets `cloak_rt` cookie |
| POST   | `/refresh`               | uses `cloak_rt` cookie; rotates it | `200 { accessToken, expiresIn }` |
| POST   | `/logout`                | revokes current session | `204` |
| GET    | `/me`                    | current anonymous profile + prefs | `200 { profile, prefs }` |
| GET    | `/sessions`              | list this user's active devices/sessions | `200 { data: [{ id, deviceLabel, lastActiveAt, current }] }` |
| DELETE | `/sessions/:id`          | revoke a specific device session | `204` |

> OAuth (Google/Microsoft) is designed as an alternate credential on `AuthUser`
> with the same domain restriction; wired in a later phase.

---

## Identity & Profiles  — Phase 1 ✅ (core)

| Method | Path                          | Notes |
|--------|-------------------------------|-------|
| POST   | `/v1/identity/regenerate`     | New anonymous username/avatar per config rules (cooldown + max/day). `200 { profile }` or `409 USERNAME_TAKEN` |
| PATCH  | `/v1/identity/username`       | `{ username }` custom, validated + uniqueness |
| GET    | `/v1/profiles/:profileId`     | Public profile ONLY (username, avatar, bio, karma, level, badges, joinDate). Never real identity |
| PATCH  | `/v1/profiles/me`             | `{ bio?, avatarKind?, avatarSeed?, presenceVisible? }` |

---

## Channels (`/v1/channels`)  — Phase 1 ✅ (core)

| Method | Path                                  | Notes |
|--------|---------------------------------------|-------|
| GET    | `/`                                   | List channels visible to the user |
| POST   | `/`                                   | Create `{ slug, name, description?, topic?, visibility }` |
| GET    | `/:id`                                | Channel detail + memberCount |
| PATCH  | `/:id`                                | Update (owner/admin) |
| POST   | `/:id/archive`                        | Archive (owner/admin) |
| DELETE | `/:id`                                | Delete (owner/admin) |
| GET    | `/:id/members`                        | Anonymous members + presence |
| POST   | `/:id/join` · `/:id/leave`            | Membership |
| GET    | `/:id/pins`                           | Pinned messages |

---

## Messaging (`/v1/channels/:id/messages`, `/v1/messages`)  — Phase 1 ✅ (core)

| Method | Path                                      | Notes |
|--------|-------------------------------------------|-------|
| GET    | `/v1/channels/:id/messages?limit&cursor`  | **Cursor pagination**, newest-first, hydrated author (anonymous) + reactions |
| POST   | `/v1/channels/:id/messages`               | `{ body, parentId?, attachmentIds?, idempotencyKey? }` → also emits WS `message:new` |
| PATCH  | `/v1/messages/:id`                        | Edit own message → sets `editedAt`, emits `message:updated` |
| DELETE | `/v1/messages/:id`                        | Soft delete own message (mods can delete any) → `message:deleted` |
| POST   | `/v1/messages/:id/reactions`              | `{ emoji }` toggle → `reaction:updated` *(Phase 2)* |
| POST   | `/v1/messages/:id/pin` · `/bookmark` · `/report` | *(Phase 2)* |
| GET    | `/v1/messages/:id/thread`                 | Thread replies *(Phase 2)* |

---

## Search / Media / Voice / Video / Gamification / Community / Moderation

Full contracts are defined per module and implemented in their phases
(3–10). Representative examples:

- **Search:** `GET /v1/search/messages?q=from:BlueFox42 docker channel:tech has:image after:2026-09-01`
  → parsed into structured filters, served from Postgres FTS + filter indexes.
- **Media:** `POST /v1/media/uploads` (declare mime+size → signed PUT URL),
  `POST /v1/media/uploads/:id/complete`, `GET /v1/media/:id/url` (signed GET).
- **Voice/Video rooms:** `POST /v1/voice-rooms`, `POST /v1/voice-rooms/:id/token`
  (SFU join token bound to the anonymous identity).
- **Moderation (elevated + audited):** `POST /v1/mod/reports/:id/actions`,
  `POST /v1/mod/identity/:profileId/unmask` (role=ADMIN, writes `AuditLog`).

Every listed endpoint runs through the same guards + anonymization mapper.
