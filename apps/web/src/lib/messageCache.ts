import { queryClient } from './queryClient';
import type { Page, PublicMessage, PublicPoll, ReactionSummary } from '../types';

export type MessagePages = { pages: Page<PublicMessage>[]; pageParams: unknown[] };

export const messagesKey = (channelId: string) => ['messages', channelId] as const;
export const dmKey = (threadId: string) => ['dm-messages', threadId] as const;

/** Insert a newly-arrived message at the top of the newest page (deduped by id). */
export function applyNewMessage(message: PublicMessage): void {
  if (!message.channelId) return;
  queryClient.setQueryData<MessagePages>(messagesKey(message.channelId), (old) => {
    if (!old || old.pages.length === 0) return old;
    const exists = old.pages.some((pg) => pg.data.some((m) => m.id === message.id));
    if (exists) return old;
    const pages = old.pages.slice();
    pages[0] = { ...pages[0], data: [message, ...pages[0].data] };
    return { ...old, pages };
  });
}

export function applyUpdatedMessage(
  channelId: string,
  messageId: string,
  body: string,
  editedAt: string | null,
): void {
  queryClient.setQueryData<MessagePages>(messagesKey(channelId), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((pg) => ({
        ...pg,
        data: pg.data.map((m) => (m.id === messageId ? { ...m, body, editedAt } : m)),
      })),
    };
  });
}

export function applyDeletedMessage(channelId: string, messageId: string): void {
  queryClient.setQueryData<MessagePages>(messagesKey(channelId), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((pg) => ({
        ...pg,
        data: pg.data.map((m) => (m.id === messageId ? { ...m, deleted: true, body: '' } : m)),
      })),
    };
  });
}

/** message:updated / message:deleted payloads omit the channel; patch every cached channel. */
export function applyUpdatedAcrossChannels(messageId: string, body: string, editedAt: string | null): void {
  for (const q of queryClient.getQueryCache().findAll({ queryKey: ['messages'] })) {
    const channelId = q.queryKey[1] as string | undefined;
    if (channelId) applyUpdatedMessage(channelId, messageId, body, editedAt);
  }
}

export function applyDeletedAcrossChannels(messageId: string): void {
  for (const q of queryClient.getQueryCache().findAll({ queryKey: ['messages'] })) {
    const channelId = q.queryKey[1] as string | undefined;
    if (channelId) applyDeletedMessage(channelId, messageId);
  }
}

// ---- Direct messages (separate infinite cache per thread) ----

export function applyNewDmMessage(threadId: string, message: PublicMessage): void {
  queryClient.setQueryData<MessagePages>(dmKey(threadId), (old) => {
    if (!old || old.pages.length === 0) return old;
    const exists = old.pages.some((pg) => pg.data.some((m) => m.id === message.id));
    if (exists) return old;
    const pages = old.pages.slice();
    pages[0] = { ...pages[0], data: [message, ...pages[0].data] };
    return { ...old, pages };
  });
}

// ---- Reactions ----

/** Patch a single message wherever it is cached (any channel or DM thread). */
function patchMessage(messageId: string, patch: (m: PublicMessage) => PublicMessage): void {
  const caches = [
    ...queryClient.getQueryCache().findAll({ queryKey: ['messages'] }),
    ...queryClient.getQueryCache().findAll({ queryKey: ['dm-messages'] }),
  ];
  for (const q of caches) {
    queryClient.setQueryData<MessagePages>(q.queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((pg) => ({
          ...pg,
          data: pg.data.map((m) => (m.id === messageId ? patch(m) : m)),
        })),
      };
    });
  }
}

/** Replace a message's reactions with an authoritative per-viewer summary. */
export function applyReactionSummary(messageId: string, reactions: ReactionSummary[]): void {
  patchMessage(messageId, (m) => ({ ...m, reactions }));
}

/**
 * Apply a broadcast reaction update. Counts are authoritative; `reactedByMe` is
 * preserved from local state and only flipped when the actor is the current user.
 */
export function applyReactionUpdate(
  update: { messageId: string; counts: { emoji: string; count: number }[]; actorProfileId: string; emoji: string; op: 'add' | 'remove' },
  myId?: string,
): void {
  patchMessage(update.messageId, (m) => {
    const prevByEmoji = new Map(m.reactions.map((r) => [r.emoji, r.reactedByMe]));
    const reactions: ReactionSummary[] = update.counts.map((c) => {
      let reactedByMe = prevByEmoji.get(c.emoji) ?? false;
      if (myId && update.actorProfileId === myId && c.emoji === update.emoji) {
        reactedByMe = update.op === 'add';
      }
      return { emoji: c.emoji, count: c.count, reactedByMe };
    });
    return { ...m, reactions };
  });
}



/** Patch a poll message's tallies (from a poll:update broadcast or a vote). */
export function applyPollUpdate(messageId: string, poll: PublicPoll): void {
  patchMessage(messageId, (m) => ({ ...m, poll }));
}
