import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { bootstrap } from './lib/api';
import { useAuth } from './store/auth';
import { AuthFlow } from './features/auth/AuthFlow';
import { AppShell } from './features/chat/AppShell';
import { ChannelPage } from './features/chat/ChannelPage';
import { HomePage } from './features/home/HomePage';
import { ProfilePage } from './features/profile/ProfilePage';
import { DmListPage } from './features/dm/DmListPage';
import { DmThreadPage } from './features/dm/DmThreadPage';
import { BookmarksPage } from './features/bookmarks/BookmarksPage';
import { LeaderboardPage } from './features/leaderboard/LeaderboardPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { RoomsPage } from './features/rooms/RoomsPage';
// Lazy-loaded: pulls in the heavy LiveKit client only when a room is opened.
const RoomPage = lazy(() =>
  import('./features/rooms/RoomPage').then((m) => ({ default: m.RoomPage })),
);
import { CommunityPage } from './features/community/CommunityPage';
import { AdminPage } from './features/admin/AdminPage';
import { SearchPage } from './features/search/SearchPage';
import { SocketProvider } from './lib/socket';
import { Logo, Spinner, Toaster } from './components/ui';

function Splash(): JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center gap-3 text-ink-soft">
      <Logo className="text-xl" />
      <Spinner />
    </div>
  );
}

export default function App(): JSX.Element {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    bootstrap().then((ok) => {
      if (!ok) useAuth.getState().setStatus('anon');
    });
  }, []);

  return (
    <>
      {status === 'loading' ? (
        <Splash />
      ) : status === 'authed' ? (
        <BrowserRouter>
          <SocketProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<HomePage />} />
                <Route path="c/:channelId" element={<ChannelPage />} />
                <Route path="dm" element={<DmListPage />} />
                <Route path="dm/:threadId" element={<DmThreadPage />} />
                <Route path="me" element={<ProfilePage />} />
                <Route path="u/:profileId" element={<ProfilePage />} />
                <Route path="bookmarks" element={<BookmarksPage />} />
                <Route path="leaderboard" element={<LeaderboardPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="community" element={<CommunityPage />} />
                <Route path="rooms/:kind" element={<RoomsPage />} />
                <Route
                  path="rooms/:kind/:id"
                  element={
                    <Suspense fallback={<Splash />}>
                      <RoomPage />
                    </Suspense>
                  }
                />
                <Route path="admin" element={<AdminPage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </SocketProvider>
        </BrowserRouter>
      ) : (
        <AuthFlow />
      )}
      <Toaster />
    </>
  );
}
