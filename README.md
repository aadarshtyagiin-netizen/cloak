# 🕶️ Cloak

**An anonymous community chat app for Snapdeal.**
*Anonymous to the community, accountable to the platform.*

You authenticate with your Snapdeal email, but inside Cloak you are only ever
`🐼 PixelPanda81`. Your real identity is kept on the backend for authentication,
security, moderation, and audit — and is **never** exposed to other users through
any API or real-time event.

> **Status:** all 10 roadmap phases are implemented and runnable — Snapdeal-email
> auth, anonymous identities, real-time channel chat, threads, DMs, reactions,
> mentions & notifications, media/voice messages, polls, community features,
> gamification, moderation/admin, search, and LiveKit voice/video rooms. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Documentation

| Doc | What's inside |
|-----|---------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, module boundaries, tech choices & rationale |
| [docs/DATABASE.md](docs/DATABASE.md) | Two-identity model, ER diagram, indexes & constraints |
| [docs/API.md](docs/API.md) | REST contracts, error codes, pagination, idempotency |
| [docs/WEBSOCKET.md](docs/WEBSOCKET.md) | Socket.IO events, presence & typing model |
| [docs/SECURITY.md](docs/SECURITY.md) | Privacy invariant, auth controls, abuse/moderation |
| [docs/FRONTEND.md](docs/FRONTEND.md) | React component hierarchy, state strategy, UX |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The 10 development phases |

---

## Tech stack

- **Backend:** TypeScript · Fastify · Prisma · PostgreSQL · Redis · Socket.IO
- **Frontend:** React · Vite · TypeScript · Tailwind · Zustand · TanStack Query
- **Infra (local):** Docker Compose — Postgres, Redis, Mailhog, MinIO, LiveKit (SFU)
- **Real-time:** Socket.IO (chat/presence/typing) + LiveKit SFU for scalable voice/video rooms

---

## Quick start

Prerequisites: **Node ≥ 20**, **Docker**.

```bash
# 1. Install workspace dependencies
npm install

# 2. Start local infrastructure (Postgres, Redis, Mailhog, MinIO, LiveKit)
npm run infra:up

# 3. Configure env
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env

# 4. Create the database schema + product catalogs & default channels (no fake users)
npm run db:migrate
npm run db:seed

# 5. Run the API (:4000) and web app (:5173)
npm run dev
```

Then open **http://localhost:5173**.

### Access from other devices (ngrok)

To use Cloak from your phone or another machine, expose the web app with a
tunnel — Vite proxies the API + WebSocket, so one tunnel covers everything:

```bash
ngrok config add-authtoken <token>   # one-time, free at dashboard.ngrok.com
npm run dev:public                    # server + web + ngrok together
```

Open the `https://…ngrok-free.app` URL it prints. See [`docs/NGROK.md`](docs/NGROK.md) for details.

### Logging in (dev)

1. Enter any `@snapdeal.com` email (e.g. `aadarsh@snapdeal.com`). In dev,
   `example.com` is also allowed for testing (`ALLOW_TEST_DOMAIN=true`).
2. Get the 6-digit code from **Mailhog** at http://localhost:8025 (or from the
   server console — `OTP_DEV_LOG=true`).
3. You're issued a generated anonymous identity like `BlueFox42`. Open a second
   browser/incognito tab, log in as another address, and chat in real time.

The database ships with **no fake users** — every identity is minted on first
login. To make yourself an admin/moderator, add your email to `ADMIN_EMAILS` in
`apps/server/.env` and log in (or re-log in); the role is applied on sign-in.
Voice/video rooms use the LiveKit SFU (`cloak-livekit`) started by `infra:up`.

You will **never** see anyone's email or real name in the UI or in any API/WS
response — this is enforced by the anonymization boundary and covered by tests.

---

## Shipping to production

Two services need real (not dev) configuration before you ship. Both are driven
entirely by env vars in `apps/server/.env` — no code changes.

**1. Real email delivery.** Dev uses Mailhog (a catcher). For real inboxes pick one:

- **Resend (recommended)** — HTTPS API, resilient to blocked SMTP ports:
  ```env
  EMAIL_TRANSPORT=resend
  RESEND_API_KEY=re_xxxxxxxx          # from resend.com
  EMAIL_FROM=Cloak <no-reply@snapdeal.com>   # verified domain (or onboarding@resend.dev to test)
  ```
- **SMTP** — any real relay (Google Workspace, Amazon SES, Mailgun…):
  ```env
  EMAIL_TRANSPORT=smtp
  SMTP_HOST=smtp.your-provider.com
  SMTP_PORT=587            # 465 uses implicit TLS automatically
  SMTP_USER=...
  SMTP_PASS=...
  ```

The API verifies the transport at startup and, on a real transport, returns a
clear error to the client if a code can't be sent (instead of silently failing).
Set `OTP_DEV_LOG=false` in production so codes are never written to logs.

**2. LiveKit voice/video.** The `--dev` server from `infra:up` only works on the
host machine (`ws://localhost:7880`). Browsers on HTTPS require a secure `wss://`
socket, so for cross-device / ngrok / production use **LiveKit Cloud**
(free tier at https://cloud.livekit.io) or a TLS-terminated self-hosted server:

```env
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<real key>
LIVEKIT_API_SECRET=<real secret>
```

In `NODE_ENV=production` the rooms API refuses `ws://` URLs and the dev
`devkey`/`secret`, so a misconfiguration surfaces immediately instead of failing
silently in the browser.

Also set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, a pinned `WEB_ORIGIN`,
and your admin email(s) in `ADMIN_EMAILS`.

---

## Useful commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Run API + web together |
| `npm run infra:up` / `infra:down` | Start / stop Docker services |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed reaction/badge/achievement catalogs + default channels (no fake users) |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm test` | Run backend tests (auth, identity, **privacy**) |
| `npm run lint` / `format` | Lint / format |

---

## Repository layout

```
cloak/
├─ docs/               design + specs (read these first)
├─ apps/
│  ├─ server/          Fastify API + Socket.IO + Prisma (modular monolith)
│  └─ web/             React + Vite client
├─ docker-compose.yml  local Postgres / Redis / Mailhog / MinIO
├─ .env.example
└─ package.json        npm workspaces
```

## Security & privacy at a glance

- Two identities: private `AuthUser` (email/role) vs public `AnonymousProfile`
  (username/avatar). Public entities reference only the profile id.
- A single response mapper is the only way to build client DTOs; it cannot emit
  email / real name / employee id / internal user id.
- Snapdeal-domain restriction, hashed OTPs, rotating refresh tokens, session
  revocation, rate limiting and brute-force protection.
- Identity unmasking is admin-only and always audit-logged.

See [docs/SECURITY.md](docs/SECURITY.md) for the full model.
