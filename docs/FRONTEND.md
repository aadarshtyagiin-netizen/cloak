# Cloak — Frontend Architecture

Stack: **React 18 + TypeScript + Vite + Tailwind CSS + Zustand + TanStack Query +
Socket.IO client + React Router**.

## 1. State strategy

- **Server state** (channels, messages, profile) → **TanStack Query** with cache
  keys per resource; WebSocket events patch the query cache directly (no refetch
  storms).
- **Session/auth state** (access token in memory, current profile) → **Zustand**
  store; access token is kept in memory (not localStorage) and re-minted via the
  refresh cookie on load.
- **Ephemeral UI** (composer draft, typing, modals, theme) → local component state
  / small Zustand slices.

## 2. Component hierarchy (Phase 1)

```
<App>
 ├─ <ThemeProvider>            dark/light, system-aware
 ├─ <AuthGate>                 bootstraps session via /auth/refresh
 │   ├─ <LoginPage>            email entry (Snapdeal domain hint + errors)
 │   └─ <VerifyPage>           OTP entry, resend, lockout states
 └─ <AppShell>                 authenticated layout
     ├─ <Sidebar>
     │   ├─ <CommunityHeader/> logo + name
     │   ├─ <SearchButton/>    ⌘K
     │   ├─ <ChannelList/>     public/private channels, unread badges
     │   ├─ <DMList/>          (Phase 2)
     │   ├─ <NavItems/>        Voice, Video, Bookmarks, Trending, Notifications
     │   └─ <SelfPresenceCard/> anonymous username + avatar + status switch
     └─ <ChatView>
         ├─ <ChannelHeader/>   name, topic, memberCount, search, notif settings
         ├─ <MessageList/>     virtualized, infinite scroll (cursor), grouping
         │   └─ <MessageRow/>  avatar, username, time, body, hover actions
         ├─ <TypingIndicator/> "BlueFox42 is typing…"
         └─ <Composer/>        textarea, emoji btn, attach btn, send (⌘⏎)
```

Later phases add `<ThreadPanel/>`, `<EmojiPicker/>`, `<GifPicker/>`,
`<VoiceRecorder/>`, `<VoiceRoom/>`, `<VideoRoom/>`, `<PollCard/>`,
`<ProfileCard/>`, `<AdminDashboard/>`, `<CommandPalette/>`.

## 3. Real-time integration

- A single `SocketProvider` owns the Socket.IO connection, (re)authenticated with
  the in-memory access token; reconnect with backoff.
- Incoming `message:new` / `message:updated` / `message:deleted` mutate the
  relevant TanStack Query message pages in place → instant UI, no polling.
- Optimistic send: composer inserts a pending message keyed by `clientNonce`,
  reconciled when the server echoes it.

## 4. Design system & UX

- Tailwind design tokens (color, spacing, radius) with **dark + light** themes and
  CSS variables; `prefers-color-scheme` default with manual override.
- Motion: small, purposeful transitions (message enter, reaction pop, room join,
  level-up) via `framer-motion`; respect `prefers-reduced-motion`. Do **not**
  over-animate.
- States: skeleton loaders, empty states, toasts, confirmation dialogs,
  drag-and-drop upload zone.
- **Keyboard shortcuts:** `⌘/Ctrl+K` search · `⌘/Ctrl+⏎` send · `Esc` close ·
  `R` reply · `E` edit · `↑` edit last message.
- Responsive: collapsible sidebar + bottom nav on mobile; desktop optimized
  three-pane layout.
- Accessibility: semantic roles, focus management in dialogs, ARIA live region for
  new messages and typing, sufficient contrast in both themes.

## 5. Project layout (`apps/web/src`)

```
main.tsx  App.tsx
lib/        api.ts (fetch + refresh), socket.ts, queryClient.ts
store/      auth.ts, ui.ts
features/
  auth/     LoginPage, VerifyPage, useAuth
  chat/     AppShell, Sidebar, ChatView, MessageList, MessageRow, Composer, TypingIndicator
  profile/  ProfileCard, SelfPresenceCard
components/  ui primitives (Button, Input, Avatar, Toast, Dialog, Skeleton)
hooks/       useHotkeys, useTheme, useInfiniteMessages
types/       api + ws contract types (mirrors server)
```
