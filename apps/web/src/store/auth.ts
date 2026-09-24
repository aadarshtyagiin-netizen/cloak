import { create } from 'zustand';
import type { PublicProfile } from '../types';

interface AuthState {
  status: 'loading' | 'authed' | 'anon';
  accessToken: string | null;
  profile: PublicProfile | null;
  setAuth: (token: string, profile: PublicProfile) => void;
  setToken: (token: string) => void;
  setProfile: (profile: PublicProfile) => void;
  setStatus: (status: AuthState['status']) => void;
  clear: () => void;
}

/**
 * Auth state. The access token lives in memory only (never localStorage) — it is
 * re-minted from the httpOnly refresh cookie on load, which keeps it out of reach
 * of XSS-readable storage.
 */
export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  profile: null,
  setAuth: (accessToken, profile) => set({ accessToken, profile, status: 'authed' }),
  setToken: (accessToken) => set({ accessToken }),
  setProfile: (profile) => set({ profile }),
  setStatus: (status) => set({ status }),
  clear: () => set({ accessToken: null, profile: null, status: 'anon' }),
}));
