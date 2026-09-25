import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Clock } from 'lucide-react';
import { EMOJI_GROUPS, getRecentEmojis, pushRecentEmoji } from '../../lib/emoji';
import { cx } from '../../components/ui';

// A representative glyph for each category's jump button (category chrome, not UI icon).
const GROUP_ICON: Record<string, string> = {
  Smileys: '😀',
  Gestures: '👍',
  Hearts: '❤️',
  Fun: '✨',
  Animals: '🐼',
};

/**
 * A compact, Discord-style emoji picker: search, a category jump rail, a
 * recently-used row, and grouped sections. Purely presentational — the parent
 * decides placement and what to do on pick.
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const openedAt = useRef(performance.now());
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>(EMOJI_GROUPS[0]?.name ?? '');
  const recent = useMemo(() => getRecentEmojis(), []);

  useEffect(() => {
    // Use `click` (not `mousedown`) so the trigger button's own onClick — which
    // fires first — can toggle the picker closed without this handler racing it
    // open again (the classic "picker won't close / flickers" bug). The 250ms
    // guard ignores the very click that opened the picker, so it can never
    // close itself on mount regardless of React's event/effect timing.
    function onClickOutside(e: MouseEvent): void {
      if (performance.now() - openedAt.current < 250) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('click', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function pick(emoji: string): void {
    pushRecentEmoji(emoji);
    onSelect(emoji);
  }

  function jumpTo(name: string): void {
    setActiveGroup(name);
    sectionRefs.current[name]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const q = query.trim().toLowerCase();
  const results = q ? EMOJI_GROUPS.flatMap((g) => g.emojis).filter((e) => e.includes(query.trim())) : [];

  return (
    <div
      ref={ref}
      className={cx(
        'flex w-[21rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-pop-lg animate-pop-in',
        className,
      )}
      role="dialog"
      aria-label="Emoji picker"
    >
      <div className="p-2.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            autoFocus
            className="input py-2 pl-9 text-sm"
            placeholder="Search emoji"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex min-h-0">
        {/* Category jump rail */}
        {!q ? (
          <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line/60 py-1">
            {recent.length > 0 ? (
              <RailButton active={false} onClick={() => jumpTo('Recent')} title="Recently used">
                <Clock className="h-[18px] w-[18px] text-ink-soft" />
              </RailButton>
            ) : null}
            {EMOJI_GROUPS.map((g) => (
              <RailButton key={g.name} active={activeGroup === g.name} onClick={() => jumpTo(g.name)} title={g.name}>
                <span className="text-lg leading-none">{GROUP_ICON[g.name] ?? '🙂'}</span>
              </RailButton>
            ))}
          </div>
        ) : null}

        <div ref={scrollRef} className="max-h-64 flex-1 overflow-y-auto px-2 pb-2">
          {q ? (
            results.length > 0 ? (
              <Section title="Search results">
                {results.map((e, i) => (
                  <EmojiButton key={`res-${e}-${i}`} emoji={e} onClick={() => pick(e)} />
                ))}
              </Section>
            ) : (
              <p className="px-1 py-8 text-center text-sm text-ink-soft">No emoji found</p>
            )
          ) : (
            <>
              {recent.length > 0 ? (
                <div
                  ref={(el) => {
                    sectionRefs.current['Recent'] = el;
                  }}
                >
                  <Section title="Recently used">
                    {recent.map((e) => (
                      <EmojiButton key={`r-${e}`} emoji={e} onClick={() => pick(e)} />
                    ))}
                  </Section>
                </div>
              ) : null}
              {EMOJI_GROUPS.map((g) => (
                <div
                  key={g.name}
                  ref={(el) => {
                    sectionRefs.current[g.name] = el;
                  }}
                >
                  <Section title={g.name}>
                    {g.emojis.map((e, i) => (
                      <EmojiButton key={`${g.name}-${e}-${i}`} emoji={e} onClick={() => pick(e)} />
                    ))}
                  </Section>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RailButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-brand-500/15' : 'hover:bg-surface-3',
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1.5">
      <div className="sticky top-0 z-10 bg-surface-2/95 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft backdrop-blur">
        {title}
      </div>
      <div className="grid grid-cols-8 gap-0.5">{children}</div>
    </div>
  );
}

function EmojiButton({ emoji, onClick }: { emoji: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none transition hover:scale-110 hover:bg-surface-3 active:scale-95"
    >
      {emoji}
    </button>
  );
}
