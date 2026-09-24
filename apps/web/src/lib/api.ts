import { useAuth } from '../store/auth';
import type {
  AdminBadge,
  AdminStats,
  ApiErrorShape,
  AuditEntry,
  BadgeCatalogEntry,
  BookmarkView,
  ChannelMemberView,
  ConfessionView,
  DmThreadView,
  EventView,
  IcebreakerView,
  LeaderboardEntry,
  LinkPreviewView,
  NotificationView,
  NotificationLevel,
  NotificationPreferences,
  Page,
  PairingResult,
  PendingConfession,
  PinView,
  ProfileOverview,
  PublicAttachment,
  PublicChannel,
  PublicMessage,
  PublicPoll,
  PublicProfile,
  ReactionSummary,
  ReportView,
  RoomKind,
  RoomView,
  SearchResult,
  ThreadView,
  UnmaskResult,
} from '../types';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Coalesce concurrent refreshes into one in-flight request.
let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string; profile: PublicProfile };
        useAuth.getState().setAuth(data.accessToken, data.profile);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = useAuth.getState().accessToken;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Transparently refresh the access token once on 401, then retry.
  if (res.status === 401 && opts.retry !== false) {
    const ok = await doRefresh();
    if (ok) return api<T>(path, { ...opts, retry: false });
    useAuth.getState().clear();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (json as { error?: ApiErrorShape }).error;
    throw new ApiError(err?.code ?? 'INTERNAL', err?.message ?? 'Request failed.', res.status, err?.details);
  }
  return json as T;
}

// ---- Typed endpoint helpers ----

export const authApi = {
  requestCode: (email: string) =>
    api<{ challengeId: string; expiresInSec: number }>('/v1/auth/request-code', {
      method: 'POST',
      body: { email },
    }),
  verifyCode: (challengeId: string, code: string) =>
    api<{ accessToken: string; expiresIn: number; profile: PublicProfile }>('/v1/auth/verify-code', {
      method: 'POST',
      body: { challengeId, code },
    }),
  me: () => api<{ profile: PublicProfile }>('/v1/auth/me'),
  logout: () => api<void>('/v1/auth/logout', { method: 'POST' }),
};

export const identityApi = {
  regenerate: () => api<{ profile: PublicProfile }>('/v1/identity/regenerate', { method: 'POST' }),
  setUsername: (username: string) =>
    api<{ profile: PublicProfile }>('/v1/identity/username', { method: 'PATCH', body: { username } }),
};

export interface SendOptions {
  parentId?: string;
  attachmentIds?: string[];
  voice?: { attachmentId: string; durationMs: number; waveform: number[] };
}

export const channelsApi = {
  list: () => api<{ data: PublicChannel[] }>('/v1/channels'),
  get: (id: string) => api<{ channel: PublicChannel }>(`/v1/channels/${id}`),
  members: (id: string) => api<{ data: ChannelMemberView[] }>(`/v1/channels/${id}/members`),
  messages: (id: string, cursor?: string | null, limit = 40) =>
    api<Page<PublicMessage>>(
      `/v1/channels/${id}/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  send: (id: string, body: string, opts: SendOptions = {}) =>
    api<{ message: PublicMessage }>(`/v1/channels/${id}/messages`, {
      method: 'POST',
      body: { body, ...opts },
    }),
};

export const messagesApi = {
  edit: (id: string, body: string) =>
    api<{ message: PublicMessage }>(`/v1/messages/${id}`, { method: 'PATCH', body: { body } }),
  remove: (id: string) => api<{ id: string }>(`/v1/messages/${id}`, { method: 'DELETE' }),
  react: (id: string, emoji: string) =>
    api<{ reactions: ReactionSummary[] }>(`/v1/messages/${id}/reactions`, {
      method: 'POST',
      body: { emoji },
    }),
  toggleBookmark: (id: string) =>
    api<{ bookmarked: boolean }>(`/v1/messages/${id}/bookmark`, { method: 'POST' }),
  thread: (id: string) => api<ThreadView>(`/v1/messages/${id}/thread`),
};

export const channelExtrasApi = {
  create: (input: { slug: string; name: string; description?: string; visibility?: 'PUBLIC' | 'PRIVATE' }) =>
    api<{ channel: PublicChannel }>('/v1/channels', { method: 'POST', body: input }),
  join: (id: string) => api<{ channel: PublicChannel }>(`/v1/channels/${id}/join`, { method: 'POST' }),
  leave: (id: string) => api<void>(`/v1/channels/${id}/leave`, { method: 'POST' }),
  pins: (id: string) => api<{ data: PinView[] }>(`/v1/channels/${id}/pins`),
  togglePin: (id: string, messageId: string) =>
    api<{ pinned: boolean }>(`/v1/channels/${id}/pins`, { method: 'POST', body: { messageId } }),
};

export const bookmarksApi = {
  list: () => api<{ data: BookmarkView[] }>('/v1/bookmarks'),
};

export const notificationsApi = {
  list: (unreadOnly = false) =>
    api<{ data: NotificationView[] }>(`/v1/notifications${unreadOnly ? '?unreadOnly=true' : ''}`),
  unreadCount: () => api<{ count: number }>('/v1/notifications/unread-count'),
  markRead: (ids?: string[]) => api<void>('/v1/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
  getPreferences: () => api<NotificationPreferences>('/v1/notifications/preferences'),
  setPreference: (channelId: string | null, level: NotificationLevel) =>
    api<void>('/v1/notifications/preferences', { method: 'PUT', body: { channelId, level } }),
};

export const dmApi = {
  list: () => api<{ data: DmThreadView[] }>('/v1/dm'),
  open: (profileId: string) => api<{ thread: DmThreadView }>('/v1/dm/open', { method: 'POST', body: { profileId } }),
  messages: (threadId: string, cursor?: string | null, limit = 40) =>
    api<Page<PublicMessage>>(
      `/v1/dm/${threadId}/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  send: (threadId: string, body: string, attachmentIds?: string[]) =>
    api<{ message: PublicMessage }>(`/v1/dm/${threadId}/messages`, { method: 'POST', body: { body, attachmentIds } }),
  read: (threadId: string, lastMessageId: string) =>
    api<void>(`/v1/dm/${threadId}/read`, { method: 'POST', body: { lastMessageId } }),
};

export const gamificationApi = {
  meOverview: () => api<ProfileOverview>('/v1/gamification/me/overview'),
  profileOverview: (id: string) => api<ProfileOverview>(`/v1/gamification/profiles/${id}/overview`),
  leaderboard: (period: 'all' | 'week' = 'all') =>
    api<{ period: string; data: LeaderboardEntry[] }>(`/v1/gamification/leaderboard?period=${period}`),
  badges: () => api<{ data: BadgeCatalogEntry[] }>('/v1/gamification/badges'),
};

export const profilesApi = {
  get: (id: string) => api<{ profile: PublicProfile }>(`/v1/profiles/${id}`),
  updateMe: (input: { bio?: string; presenceVisible?: boolean; avatarSeed?: string; avatarKind?: 'GENERATED' | 'UPLOADED'; avatarUrl?: string | null }) =>
    api<{ profile: PublicProfile }>('/v1/profiles/me', { method: 'PATCH', body: input }),
};

export interface ReportInput {
  targetType: 'MESSAGE' | 'USER' | 'CHANNEL';
  targetProfileId?: string;
  targetMessageId?: string;
  targetChannelId?: string;
  reason: string;
  details?: string;
}

export const moderationApi = {
  report: (input: ReportInput) => api<{ id: string }>('/v1/moderation/reports', { method: 'POST', body: input }),
  blocks: () => api<{ data: PublicProfile[] }>('/v1/moderation/blocks'),
  toggleBlock: (profileId: string) =>
    api<{ blocked: boolean }>('/v1/moderation/blocks', { method: 'POST', body: { profileId } }),
  mutes: () => api<{ data: PublicProfile[] }>('/v1/moderation/mutes'),
  toggleMute: (profileId: string) =>
    api<{ muted: boolean }>('/v1/moderation/mutes', { method: 'POST', body: { profileId } }),
};

/** On app load, mint an access token from the httpOnly refresh cookie (if any). */
export function bootstrap(): Promise<boolean> {
  return doRefresh();
}



// ---- Media upload (multipart; bypasses the JSON api() wrapper) ----

export async function uploadMedia(
  file: File | Blob,
  fields?: Record<string, string | number>,
  retry = true,
): Promise<PublicAttachment> {
  const token = useAuth.getState().accessToken;
  const form = new FormData();
  if (fields) for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', file, file instanceof File ? file.name : 'upload');
  const res = await fetch(`${BASE}/v1/media`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: form,
  });
  if (res.status === 401 && retry) {
    const ok = await doRefresh();
    if (ok) return uploadMedia(file, fields, false);
    useAuth.getState().clear();
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (json as { error?: ApiErrorShape }).error;
    throw new ApiError(err?.code ?? 'INTERNAL', err?.message ?? 'Upload failed.', res.status, err?.details);
  }
  return (json as { attachment: PublicAttachment }).attachment;
}

export const linkPreviewApi = {
  get: (url: string) => api<LinkPreviewView>(`/v1/link-preview?url=${encodeURIComponent(url)}`),
};

export const pollsApi = {
  create: (input: { channelId: string; question: string; options: string[]; mode?: 'SINGLE' | 'MULTI'; anonymous?: boolean; expiresInHours?: number }) =>
    api<{ message: PublicMessage }>('/v1/polls', { method: 'POST', body: input }),
  vote: (pollId: string, optionIds: string[]) =>
    api<{ poll: PublicPoll }>(`/v1/polls/${pollId}/vote`, { method: 'POST', body: { optionIds } }),
};

export const communityApi = {
  events: () => api<{ data: EventView[] }>('/v1/community/events'),
  createEvent: (input: { title: string; description?: string; startsAt: string; endsAt?: string; location?: string; channelId?: string }) =>
    api<{ id: string }>('/v1/community/events', { method: 'POST', body: input }),
  rsvp: (eventId: string, status: 'GOING' | 'MAYBE' | 'NOT_GOING') =>
    api<void>(`/v1/community/events/${eventId}/rsvp`, { method: 'POST', body: { status } }),
  icebreaker: () => api<IcebreakerView>('/v1/community/icebreaker'),
  answerIcebreaker: (body: string) => api<void>('/v1/community/icebreaker/answer', { method: 'POST', body: { body } }),
  confessions: () => api<{ data: ConfessionView[] }>('/v1/community/confessions'),
  submitConfession: (body: string) => api<{ id: string }>('/v1/community/confessions', { method: 'POST', body: { body } }),
  joinPairing: () => api<PairingResult>('/v1/community/pairing/join', { method: 'POST' }),
  pairingStatus: () => api<PairingResult>('/v1/community/pairing/status'),
  leavePairing: () => api<void>('/v1/community/pairing/leave', { method: 'POST' }),
};

export const roomsApi = {
  list: (kind: RoomKind) => api<{ data: RoomView[] }>(`/v1/rooms/${kind}`),
  create: (kind: RoomKind, name: string) => api<{ room: RoomView }>(`/v1/rooms/${kind}`, { method: 'POST', body: { name } }),
  get: (kind: RoomKind, id: string) => api<{ room: RoomView }>(`/v1/rooms/${kind}/${id}`),
  join: (kind: RoomKind, id: string) => api<{ room: RoomView }>(`/v1/rooms/${kind}/${id}/join`, { method: 'POST' }),
  leave: (kind: RoomKind, id: string) => api<void>(`/v1/rooms/${kind}/${id}/leave`, { method: 'POST' }),
  state: (kind: RoomKind, id: string, patch: Record<string, boolean>) =>
    api<void>(`/v1/rooms/${kind}/${id}/state`, { method: 'PATCH', body: { patch } }),
  token: (kind: RoomKind, id: string) =>
    api<{ token: string; url: string; room: string; identity: string; username: string }>(
      `/v1/rooms/${kind}/${id}/token`,
      { method: 'POST' },
    ),
};

export const searchApi = {
  search: (q: string) => api<{ data: SearchResult[] }>(`/v1/search?q=${encodeURIComponent(q)}`),
};

export interface ReactionPresetView {
  id: string;
  key: string;
  emoji: string;
  label: string;
  position: number;
  isActive: boolean;
}

export const adminApi = {
  stats: () => api<AdminStats>('/v1/admin/stats'),
  reports: (status?: string) => api<{ data: ReportView[] }>(`/v1/admin/reports${status ? `?status=${status}` : ''}`),
  resolveReport: (id: string, status: string) => api<void>(`/v1/admin/reports/${id}/resolve`, { method: 'POST', body: { status } }),
  userAction: (profileId: string, action: 'SUSPEND' | 'BAN' | 'UNBAN', reason?: string) =>
    api<void>(`/v1/admin/users/${profileId}/action`, { method: 'POST', body: { action, reason } }),
  deleteMessage: (id: string, reason?: string) => api<void>(`/v1/admin/messages/${id}/delete`, { method: 'POST', body: { reason } }),
  unmask: (profileId: string) => api<UnmaskResult>(`/v1/admin/unmask/${profileId}`, { method: 'POST' }),
  audit: () => api<{ data: AuditEntry[] }>('/v1/admin/audit'),
  badges: () => api<{ data: AdminBadge[] }>('/v1/admin/badges'),
  createBadge: (input: { key: string; name: string; emoji: string; description: string }) =>
    api<{ badge: AdminBadge }>('/v1/admin/badges', { method: 'POST', body: input }),
  setBadgeActive: (id: string, isActive: boolean) => api<void>(`/v1/admin/badges/${id}/active`, { method: 'POST', body: { isActive } }),
  reactions: () => api<{ data: ReactionPresetView[] }>('/v1/admin/reactions'),
  pendingConfessions: () => api<{ data: PendingConfession[] }>('/v1/admin/confessions/pending'),
  moderateConfession: (id: string, approve: boolean) =>
    api<void>(`/v1/admin/confessions/${id}/moderate`, { method: 'POST', body: { approve } }),
};
