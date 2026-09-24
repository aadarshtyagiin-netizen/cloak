# Accessing Cloak from other devices (ngrok)

Cloak runs locally on two ports — the web app (`:5173`) and the API (`:4000`).
For cross-device access you only need to expose **one** port: the web app.
Vite proxies `/v1`, `/socket.io` and `/health` to the API, so a single tunnel
to `:5173` serves the entire app — REST, WebSocket, **and** the auth cookie —
over one same-origin HTTPS URL. That same-origin property is what keeps the
httpOnly refresh-token cookie working through the tunnel.

## One-time setup

ngrok is already installed (via `winget install Ngrok.Ngrok`). ngrok requires a
free account token:

1. Create a free account and copy your token from
   <https://dashboard.ngrok.com/get-started/your-authtoken>.
2. Register it once:
   ```powershell
   ngrok config add-authtoken <your-token>
   ```
   > If `ngrok` isn't found, open a **new** terminal (winget just added it to
   > PATH) or use the full path
   > `"$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_*\ngrok.exe"`.

## Run it

Two terminals (or use the combined script below):

```powershell
# Terminal 1 — the app
npm run dev

# Terminal 2 — the public tunnel
npm run tunnel
```

Or run everything together:

```powershell
npm run dev:public      # server + web + ngrok, one command
```

ngrok prints a forwarding URL like `https://abcd-1234.ngrok-free.app`. Open it on
your phone/another laptop and sign in exactly as you would locally.

## Why it works without extra config

- **Vite** (`apps/web/vite.config.ts`) sets `host: true` and `allowedHosts: true`
  in dev, so it accepts the ngrok Host header instead of returning
  "Blocked request. This host is not allowed."
- **CORS / Socket.IO** (`apps/server/src/app.ts`, `main.ts`) reflect the request
  origin in development (`origin: isProd ? WEB_ORIGIN : true`). Without this, the
  Socket.IO handshake — whose `Origin` header is forwarded through the proxy as
  the ngrok URL — would be rejected. In production the origin is pinned to
  `WEB_ORIGIN`.
- The refresh cookie is `sameSite=strict`, `path=/v1/auth`. Because the browser
  only ever talks to the single ngrok origin, every request is same-origin and
  the cookie flows normally.

## Notes & alternatives

- **OTP emails** still land in local **Mailhog** (`http://localhost:8025`), which
  is *not* exposed by the tunnel — read the code there, on the machine running
  Cloak. (`OTP_DEV_LOG=true` also prints it to the API console.)
- The free ngrok tier shows an interstitial page on first visit and rotates the
  subdomain each run. A reserved domain (paid) avoids both — put it in
  `ngrok.yml` and run `ngrok start --config ngrok.yml cloak-web`.
- Hot-module reload may fall back to full-page reloads over the tunnel; the app
  itself works normally. For a tunnel with no HMR noise, serve a production
  build: `npm run build` then `npm --workspace @cloak/web run preview`.
- If you'd rather not create an account, `npx localtunnel --port 5173` or
  `cloudflared tunnel --url http://localhost:5173` are no-signup alternatives
  that work with the same Vite/CORS setup.
