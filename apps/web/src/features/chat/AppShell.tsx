import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { channelsApi, notificationsApi } from '../../lib/api';
import { useNotifications } from '../../store/notifications';
import { requestNotifyPermission } from '../../lib/notify';
import { Sidebar } from './Sidebar';
import type { PublicChannel } from '../../types';

export interface ShellContext {
  channels: PublicChannel[];
  channelsLoading: boolean;
  openSidebar: () => void;
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>();
}

/** Persistent layout: sidebar + routed main area. */
export function AppShell(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list });
  const channels = data?.data ?? [];
  const [mobileOpen, setMobileOpen] = useState(false);
  const setUnread = useNotifications((s) => s.setUnread);
  const navigate = useNavigate();

  useEffect(() => {
    notificationsApi
      .unreadCount()
      .then((r) => setUnread(r.count))
      .catch(() => undefined);
    void requestNotifyPermission();
  }, [setUnread]);

  // ⌘/Ctrl+K → search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const ctx: ShellContext = {
    channels,
    channelsLoading: isLoading,
    openSidebar: () => setMobileOpen(true),
  };

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar channels={channels} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
