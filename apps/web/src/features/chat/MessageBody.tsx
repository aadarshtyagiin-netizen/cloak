import { useMemo, type ReactNode } from 'react';
import { useAuth } from '../../store/auth';
import { cx } from '../../components/ui';

// Matches a URL first (so an @handle inside a link isn't split out), then an
// @mention. Broadcast handles (@everyone / @channel / @here) are styled apart.
const TOKEN_RE = /(https?:\/\/[^\s]+)|@([A-Za-z0-9_]{3,24})/g;
const BROADCAST = new Set(['everyone', 'channel', 'here']);

/**
 * Renders a message body with inline @mention chips and clickable links. The
 * current user's own mentions are emphasized so they're easy to spot.
 */
export function MessageBody({
  body,
  editedAt,
}: {
  body: string;
  editedAt?: string | null;
}): JSX.Element {
  const myUsername = useAuth((s) => s.profile?.username);
  const nodes = useMemo(() => tokenize(body, myUsername ?? undefined), [body, myUsername]);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
      {nodes}
      {editedAt ? <span className="ml-1 text-[10px] text-ink-soft">(edited)</span> : null}
    </p>
  );
}

function tokenize(body: string, myUsername?: string): ReactNode[] {
  const me = myUsername?.toLowerCase();
  const out: ReactNode[] = [];
  const re = new RegExp(TOKEN_RE); // fresh instance — the global flag is stateful
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const [full, url, mention] = m;
    if (url) {
      out.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-brand-300 underline decoration-brand-400/40 underline-offset-2 hover:text-brand-200"
        >
          {url}
        </a>,
      );
    } else if (mention !== undefined) {
      const lower = mention.toLowerCase();
      const isMe = me !== undefined && lower === me;
      const isBroadcast = BROADCAST.has(lower);
      out.push(
        <span
          key={key++}
          className={cx(
            'rounded px-1 font-medium',
            isMe
              ? 'bg-brand-500/30 text-brand-100 ring-1 ring-brand-400/40'
              : isBroadcast
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-brand-500/10 text-brand-300',
          )}
        >
          @{mention}
        </span>,
      );
    }
    last = m.index + full.length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}
