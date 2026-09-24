import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface UIState {
  theme: Theme;
  toasts: Toast[];
  soundEnabled: boolean;
  browserEnabled: boolean;
  /** Text to inject into a channel's composer (quote/forward). */
  prefill: { channelId: string; text: string } | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: number) => void;
  toggleSound: () => void;
  toggleBrowser: () => void;
  setPrefill: (channelId: string, text: string) => void;
  clearPrefill: () => void;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem('cloak-theme', theme);
  } catch {
    /* ignore */
  }
}

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('cloak-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return 'dark';
}

function initBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  return def;
}

function saveBool(key: string, val: boolean): void {
  try {
    localStorage.setItem(key, String(val));
  } catch {
    /* ignore */
  }
}

let toastSeq = 1;

export const useUI = create<UIState>((set, get) => ({
  theme: initialTheme(),
  toasts: [],
  soundEnabled: initBool('cloak-sound', true),
  browserEnabled: initBool('cloak-browser', true),
  prefill: null,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
  pushToast: (kind, message) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  toggleSound: () => {
    const next = !get().soundEnabled;
    saveBool('cloak-sound', next);
    set({ soundEnabled: next });
  },
  toggleBrowser: () => {
    const next = !get().browserEnabled;
    saveBool('cloak-browser', next);
    set({ browserEnabled: next });
  },
  setPrefill: (channelId, text) => set({ prefill: { channelId, text } }),
  clearPrefill: () => set({ prefill: null }),
}));

// Apply the persisted/default theme immediately on module load.
applyTheme(initialTheme());
