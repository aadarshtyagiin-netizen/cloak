# Cloak — Security & Privacy Model

## 1. Two identities

| | Internal identity | Public anonymous identity |
|---|---|---|
| Table | `AuthUser` | `AnonymousProfile` |
| Contains | email, employeeId, role, status | username, avatar, bio, karma, xp |
| Used for | authentication, security, moderation, audit | chat, profiles, reactions, DMs, leaderboards |
| Exposed to clients | **never** | always (this is what everyone sees) |

**Invariant:** no ordinary API or WebSocket payload may contain `email`,
`emailNormalized`, `realName`, `employeeId`, or `authUserId`. Enforced by:

1. A single **response mapper** (`toPublicProfile`, `toPublicMessage`, …) that is
   the only sanctioned way to build client DTOs.
2. An automated **privacy test** that hits representative endpoints and asserts the
   serialized JSON matches none of the forbidden keys/values (see
   `apps/server/src/tests/privacy.test.ts`).
3. Code review rule: services return domain rows internally, routes must map before
   replying.

## 2. Identity unmasking (accountability)

- Only `role = ADMIN` (or a dedicated `SECURITY` role) may call
  `POST /v1/mod/identity/:profileId/unmask`.
- Every call **must** write an `AuditLog` row (`actor`, `subject`, `reason`, `ip`,
  `timestamp`) inside the same transaction that returns the data. No audit row ⇒
  no data.
- Unmasking is rate-limited and alertable. There is no bulk export path.

## 3. Authentication controls

- **Domain restriction:** email must match the configured Snapdeal domain(s);
  `UNAUTHORIZED_DOMAIN` otherwise. Checked on both `request-code` and `verify-code`.
- **Verification codes:** 6-digit, hashed at rest (`codeHash`), short TTL, max N
  attempts then invalidated (`TOO_MANY_ATTEMPTS`).
- **Rate limiting / brute force:** per-email and per-IP token buckets on
  `request-code` / `verify-code`; progressive lockout.
- **Tokens:** short-lived access JWT (signed, `HS256`/`RS256`); refresh token is
  opaque, stored **hashed** in `Session`, delivered as httpOnly+Secure+SameSite
  cookie, and **rotated** on every refresh. Reuse of a rotated token revokes the
  whole session family (theft detection).
- **Session/device management:** users can list and revoke sessions; logout revokes
  the current session server-side.
- **No secrets in logs:** codes, tokens, and emails are redacted by the logger.

## 4. Web app protections

- **XSS:** message bodies are treated as untrusted text; rendering escapes by
  default, link/markdown rendering uses an allow-list sanitizer. No `dangerouslySetInnerHTML`
  on user content without sanitization.
- **CSRF:** state-changing requests use bearer tokens (not ambient cookies) for the
  API; the refresh cookie is `SameSite=strict` and only accepted on `/v1/auth/refresh`.
- **SQL injection:** Prisma parameterizes all queries; no string-built SQL.
- **Clickjacking / headers:** `helmet`-style headers, strict CSP, `X-Frame-Options`,
  HSTS in production.

## 5. Uploads & links

- Declared MIME + size validated up front; **actual** content sniffed by a worker.
- Executable/script types rejected; extensions never trusted.
- Private media served via **short-lived signed URLs**; voice-message download
  disabled by default.
- **Link previews** are fetched **server-side by a worker** with SSRF guards:
  block private/loopback/link-local IP ranges, cap redirects, timeout, size limit,
  and strip credentials. The client never fetches arbitrary URLs for previews.

## 6. Abuse & moderation (because it's anonymous)

- Report message/user, block, mute, channel-ban, suspend, ban.
- Spam/abuse scoring worker + per-user send rate limits.
- All moderation actions and identity unmasks are audit-logged.
- Anonymity is a **display** property, not an accountability escape hatch: the
  backend can always attribute actions to an `AuthUser` for security/legal needs,
  under audit.

## 7. Privacy-by-default logging

- Structured logs carry `profileId` (public) and request ids, **not** email or
  `authUserId`. A redaction layer scrubs known-sensitive keys.
- Analytics are aggregate/anonymous (DAU/WAU, messages/day, channel activity) — no
  per-employee behavioral profiles.
