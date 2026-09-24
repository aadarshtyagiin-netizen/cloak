import { create } from 'zustand';

interface NotificationsState {
  unread: number;
  setUnread: (n: number) => void;
  increment: () => void;
  reset: () => void;
}

/** Live unread-notification count for the sidebar/header badge. */
export const useNotifications = create<NotificationsState>((set, get) => ({
  unread: 0,
  setUnread: (unread) => set({ unread }),
  increment: () => set({ unread: get().unread + 1 }),
  reset: () => set({ unread: 0 }),
}));
