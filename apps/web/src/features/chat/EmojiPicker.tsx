import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, getRecentEmojis, pushRecentEmoji } from '../../lib/emoji';
import { cx } from '../../components/ui';

/**
 * A compact emoji picker with search, recently-used, and grouped categories.
 * Purely presentational — the parent decides placement and what to do on pick.
 */
export function EmojiPicker({
  onSelect,
  onClose,
  className,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const recent = useMemo(() => getRecentEmojis(), []);

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function pick(emoji: string): void {
    pushRecentEmoji(emoji);
    onSelect(emoji);
  }

  const q = query.trim().toLowerCase();
  const groups = q
    ? [{ name: 'Results', emojis: EMOJI_GROUPS.flatMap((g) => g.emojis) }]
    : EMOJI_GROUPS;

  return (
    <div
      ref={ref}
      className={cx(
        'z-50 w-72 rounded-2xl border border-line bg-surface-2 p-2 shadow-2xl animate-pop-in',
        className,
      )}
    >
      <input
        autoFocus
        className="input mb-2 py-1.5 text-sm"
        placeholder="Search emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto pr-1">
        {!q && recent.length > 0 ? (
          <Section title="Recent">
            {recent.map((e) => (
              <EmojiButton key={`r-${e}`} emoji={e} onClick={() => pick(e)} />
            ))}
          </Section>
        ) : null}
        {groups.map((g) => (
          <Section key={g.name} title={g.name}>
            {g.emojis.map((e, i) => (
              <EmojiButton key={`${g.name}-${e}-${i}`} emoji={e} onClick={() => pick(e)} />
            ))}
          </Section>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-2">
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{title}</div>
      <div className="grid grid-cols-8 gap-0.5">{children}</div>
    </div>
  );
}

function EmojiButton({ emoji, onClick }: { emoji: string; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-surface-3"
    >
      {emoji}
    </button>
  );
}
