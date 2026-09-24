import { create } from 'zustand';
import type { Presence } from '../types';

interface RealtimeState {
  /** profileId -> presence status (live, from the socket). */
  presence: Record<string, Presence>;
  /** channelId -> (username -> expiry timestamp ms). */
  typing: Record<string, Record<string, number>>;
  setPresence: (profileId: string, status: Presence) => void;
  setTyping: (channelId: string, username: string, isTyping: boolean) => void;
}

const TYPING_TTL_MS = 4500;

export const useRealtime = create<RealtimeState>((set, get) => ({
  presence: {},
  typing: {},
  setPresence: (profileId, status) => set({ presence: { ...get().presence, [profileId]: status } }),
  setTyping: (channelId, username, isTyping) => {
    const channel = { ...(get().typing[channelId] ?? {}) };
    if (isTyping) channel[username] = Date.now() + TYPING_TTL_MS;
    else delete channel[username];
    set({ typing: { ...get().typing, [channelId]: channel } });
  },
}));

/** Active typers for a channel (excluding expired + an optional self username). */
export function activeTypers(
  typing: Record<string, Record<string, number>>,
  channelId: string,
  excludeUsername?: string,
): string[] {
  const now = Date.now();
  const channel = typing[channelId] ?? {};
  return Object.entries(channel)
    .filter(([username, expiry]) => expiry > now && username !== excludeUsername)
    .map(([username]) => username);
}
