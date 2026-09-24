import { useEffect, useState } from 'react';
import { activeTypers, useRealtime } from '../../store/realtime';
import { useAuth } from '../../store/auth';

export function TypingIndicator({ channelId }: { channelId: string }): JSX.Element {
  const typing = useRealtime((s) => s.typing);
  const me = useAuth((s) => s.profile?.username);
  const [, setTick] = useState(0);

  // Re-evaluate once a second so expired typers disappear.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const names = activeTypers(typing, channelId, me);
  if (names.length === 0) return <div className="h-5" />;

  const text =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names.length} people are typing…`;

  return <div className="h-5 animate-fade-in px-4 text-xs text-ink-soft">{text}</div>;
}
