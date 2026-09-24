# Deploying Cloak to production

The stack:

| Piece | Service | Notes |
|-------|---------|-------|
| Web (SPA) | **Cloudflare Pages** | static hosting + CDN |
| API + realtime | **Render** (`render.yaml` included) | persistent Node + Socket.IO (Railway needs a card; Render's free web tier doesn't) |
| Database | **Supabase Postgres** | use the **Session pooler** string (see below) |
| Media storage | **Backblaze B2** | S3-compatible; via the generic `s3` driver |
| Voice/video | **LiveKit Cloud** | already configured |
| Email | **Brevo SMTP** | free transactional email |

Everything here is **configuration** — no code changes between local and prod.

---

## 1. Database — Supabase (use the Session pooler!)

⚠️ The **direct** connection `db.<ref>.supabase.co:5432` is **IPv6-only**, so it
fails from IPv4 networks (including many CI/host environments) with
`P1001 Can't reach database server`. Use the **Session pooler** string instead —
it's IPv4 and works with Prisma migrations.

In Supabase: **Project Settings → Database → Connection string → “Session pooler”**.
It looks like:
```
postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```
Use that as `DATABASE_URL`. Then apply the schema + seed:
```bash
DATABASE_URL="…session-pooler…" npm --workspace @cloak/server run db:deploy
DATABASE_URL="…session-pooler…" npm --workspace @cloak/server run db:seed
```

## 2. Media storage — Backblaze B2

1. B2 console → **Buckets** → create a private bucket (note its name + the
   **Endpoint**, e.g. `s3.us-east-005.backblazeb2.com` → region `us-east-005`).
2. **App Keys → Add a New Application Key** scoped to that bucket. Save the
   `keyID` (access key) and `applicationKey` (secret — shown once).
3. Set on the API:
   ```env
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://s3.<region>.backblazeb2.com
   S3_REGION=<region>              # e.g. us-east-005
   S3_ACCESS_KEY_ID=<keyID>
   S3_SECRET_ACCESS_KEY=<applicationKey>
   S3_BUCKET=<bucket name>
   ```
   Media is streamed through the API with signed capability URLs, so the bucket
   stays private. (The same driver works with R2/S3/MinIO — just change the endpoint.)

## 3. Voice/video — LiveKit Cloud

```env
LIVEKIT_URL=wss://cloak-plsdhrf0.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
```

## 4. Email — Brevo SMTP

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=baea17001@smtp-brevo.com
SMTP_PASS=<your Brevo SMTP key>          # Brevo → SMTP & API → SMTP → master password
EMAIL_FROM=Cloak <no-reply@yourdomain>   # add + verify the sender in Brevo first
OTP_DEV_LOG=false
```
Brevo's free plan sends ~300 emails/day. Verify your sender/domain in Brevo or
delivery will be rejected.

## 5. Deploy the API — Render (Blueprint included)

`render.yaml` at the repo root defines the API service:
1. Push the repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Fill the `sync:false` secrets in the dashboard: `DATABASE_URL` (Supabase
   session pooler), `WEB_ORIGIN`, `ADMIN_EMAILS`, `LIVEKIT_API_KEY/SECRET`,
   `S3_*`, `SMTP_USER/PASS`, `EMAIL_FROM`. (`JWT_*` are auto-generated.)
4. Deploy. Build runs `db:generate` + build; start runs `db:deploy` then the
   server. Health check: `/health`. The server honors Render's injected `PORT`.

> Free Render web services sleep after ~15 min idle and cold-start on the next
> request. Fine for testing; upgrade the instance for always-on.

## 6. Deploy the web — Cloudflare Pages

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → this repo.
2. Build settings:
   - **Build command:** `npm ci && npm --workspace @cloak/web run build`
   - **Output directory:** `apps/web/dist`
3. **Environment variables** (build-time) → point the SPA at the Render API:
   ```env
   VITE_API_URL=https://<your-render-service>.onrender.com
   VITE_WS_URL=https://<your-render-service>.onrender.com
   ```
4. SPA routing already handled by `apps/web/public/_redirects`.

## 7. Cross-origin wiring

Web (Pages) and API (Render) are different origins, so on the API set:
- `WEB_ORIGIN=https://<pages-domain>` (pins credentialed CORS + Socket.IO)
- `COOKIE_SAMESITE=none` (refresh cookie is sent cross-site; auto-marked `Secure`)

---

## Production readiness checklist

- [ ] Supabase **session pooler** `DATABASE_URL`; `db:deploy` + `db:seed` run
- [ ] `STORAGE_DRIVER=s3` with B2 endpoint/region/keys/bucket
- [ ] LiveKit Cloud `wss://` URL + keys
- [ ] Brevo SMTP creds; `OTP_DEV_LOG=false`; sender verified
- [ ] `WEB_ORIGIN` pinned, `COOKIE_SAMESITE=none`, strong `JWT_*`
- [ ] `VITE_API_URL`/`VITE_WS_URL` set on Cloudflare Pages
- [ ] HTTPS everywhere (required for mic/camera, secure cookies, `wss`)

## What I still need from you to finish

1. **Supabase Session pooler** connection string (the direct URL is IPv6-only and
   unreachable — I confirmed this). Copy it from Supabase → Database →
   Connection string → **Session pooler**, and I'll run `db:deploy` + `db:seed`.
2. **Backblaze B2**: the bucket name, the bucket's S3 **endpoint/region**, and the
   **applicationKey** (secret) — you gave the keyID (`e07a4cca808e`) but not the secret.
3. **Brevo**: the **SMTP key / master password** (you gave the login but not the password).
4. Cloudflare + Render **account access** (I can't log into those for you) — or I'll
   walk you through the two dashboard steps.
