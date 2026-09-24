// Emoji data + a tiny "recently used" store (localStorage). GIF/sticker
// providers are intentionally pluggable; only native emoji ship in this phase.

export const QUICK_REACTIONS = ['❤️', '😂', '🔥', '💡', '👏', '👀', '🚀'] as const;

export interface EmojiGroup {
  name: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '😘', '😜', '🤔', '🤗', '🤩', '😎', '🥳', '🫡', '😭', '😤', '😡', '😱', '🥺', '😴'],
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '💪', '✌️', '🤙', '👌', '🫶', '👋', '🤟', '🫰'],
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '💖', '💕'],
  },
  {
    name: 'Fun',
    emojis: ['🔥', '🚀', '⭐', '🎉', '🎊', '✨', '💡', '👀', '🍕', '☕', '🎮', '🏆', '🥇', '📈', '🎯', '🧠'],
  },
  {
    name: 'Animals',
    emojis: ['🐼', '🦊', '🐺', '🦉', '🐱', '🐶', '🦄', '🐢', '🐙', '🦎', '🐧', '🦁'],
  },
];

const RECENT_KEY = 'cloak-recent-emoji';
const MAX_RECENT = 16;

export function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): void {
  try {
    const current = getRecentEmojis().filter((e) => e !== emoji);
    const next = [emoji, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
