// Client-side mirror of the server's public DTOs (the anonymization boundary).
// These types deliberately contain NO real-identity fields.

export type Presence = 'ONLINE' | 'AWAY' | 'DND' | 'OFFLINE' | 'INVISIBLE';

export type Role = 'USER' | 'MODERATOR' | 'ADMIN';

export interface PublicProfile {
  id: string;
  username: string;
  avatarKind: 'GENERATED' | 'UPLOADED';
  avatarSeed: string;
  avatarUrl: string | null;
  bio: string | null;
  karma: number;
  xp: number;
  level: number;
  presence: Presence;
  joinedAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export type MessageContentType = 'TEXT' | 'MARKDOWN' | 'SYSTEM' | 'VOICE' | 'POLL' | 'GIF' | 'STICKER';

export type AttachmentKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF' | 'DOCUMENT' | 'OTHER';

export interface PublicAttachment {
  id: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface PublicVoiceMessage {
  durationMs: number;
  waveform: number[];
  url: string;
}

export interface PublicPollOption {
  id: string;
  label: string;
  votes: number;
}

export interface PublicPoll {
  id: string;
  question: string;
  mode: 'SINGLE' | 'MULTI';
  anonymous: boolean;
  expiresAt: string | null;
  closed: boolean;
  total: number;
  options: PublicPollOption[];
  myOptionIds: string[];
}

export interface PublicMessage {
  id: string;
  channelId: string | null;
  dmThreadId: string | null;
  author: PublicProfile;
  body: string;
  contentType: MessageContentType;
  parentId: string | null;
  threadId: string | null;
  editedAt: string | null;
  deleted: boolean;
  reactions: ReactionSummary[];
  attachments: PublicAttachment[];
  voice: PublicVoiceMessage | null;
  poll: PublicPoll | null;
  createdAt: string;
}

export interface PublicChannel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  topic: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  isArchived: boolean;
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
}

export interface ChannelMemberView {
  profile: PublicProfile;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

// ---- Phase 2+ DTOs (mirror server responses) ----

export type NotificationType =
  | 'MENTION'
  | 'DM'
  | 'THREAD_REPLY'
  | 'CHANNEL_MESSAGE'
  | 'REACTION'
  | 'VOICE_ROOM'
  | 'EVENT'
  | 'SYSTEM';

export interface NotificationView {
  id: string;
  type: NotificationType;
  actor: PublicProfile | null;
  channelId: string | null;
  messageId: string | null;
  payload: { snippet?: string; emoji?: string; threadId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface DmThreadView {
  id: string;
  other: PublicProfile | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; createdAt: string; fromMe: boolean } | null;
  unread: number;
}

export interface ProfileStats {
  messagesSent: number;
  reactionsReceived: number;
  reactionsGiven: number;
  threadsStarted: number;
  channelsJoined: number;
  bookmarks: number;
}

export interface StreakState {
  current: number;
  longest: number;
  lastActiveOn: string | null;
}

export interface BadgeView {
  key: string;
  name: string;
  emoji: string;
  description: string;
  awardedAt: string;
}

export interface AchievementView {
  key: string;
  name: string;
  emoji: string;
  description: string;
  threshold: number;
  progress: number;
  completed: boolean;
}

export interface ProfileOverview {
  profile: PublicProfile;
  stats: ProfileStats;
  streak: StreakState;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  rank: number;
  badges: BadgeView[];
  achievements: AchievementView[];
}

export interface LeaderboardEntry {
  rank: number;
  profile: PublicProfile;
  xp: number;
}

export interface BadgeCatalogEntry {
  key: string;
  name: string;
  emoji: string;
  description: string;
}

export interface BookmarkView {
  bookmarkedAt: string;
  message: PublicMessage;
}

export interface PinView {
  pinnedAt: string;
  message: PublicMessage;
}

export interface ThreadView {
  rootMessageId: string;
  replyCount: number;
  root: PublicMessage;
  replies: PublicMessage[];
}

export interface ReactionUpdate {
  messageId: string;
  counts: { emoji: string; count: number }[];
  actorProfileId: string;
  emoji: string;
  op: 'add' | 'remove';
}


// ---- Remaining-phases DTOs ----

export interface LinkPreviewView {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export type RoomKind = 'voice' | 'video';

export interface RoomParticipant {
  profile: PublicProfile;
  state: Record<string, boolean>;
}

export interface RoomView {
  id: string;
  kind: RoomKind;
  name: string;
  isActive: boolean;
  createdAt: string;
  participants: RoomParticipant[];
}

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  createdBy: PublicProfile;
  counts: { going: number; maybe: number; notGoing: number };
  myStatus: 'GOING' | 'MAYBE' | 'NOT_GOING' | null;
}

export interface IcebreakerAnswerView {
  id: string;
  body: string;
  author: PublicProfile;
  createdAt: string;
}

export interface IcebreakerView {
  id: string;
  prompt: string;
  activeOn: string;
  myAnswer: string | null;
  answers: IcebreakerAnswerView[];
}

export interface ConfessionView {
  id: string;
  body: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface PairingResult {
  status: 'WAITING' | 'MATCHED';
  other: PublicProfile | null;
  threadId: string | null;
}

export interface AdminStats {
  users: number;
  messages: number;
  channels: number;
  openReports: number;
  messages24h: number;
  dau: number;
  activeVoiceRooms: number;
  activeVideoRooms: number;
}

export interface ReportView {
  id: string;
  targetType: string;
  reporter: PublicProfile | null;
  targetProfile: PublicProfile | null;
  targetMessageId: string | null;
  messageSnippet: string | null;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
  createdAt: string;
}

export interface UnmaskResult {
  username: string;
  email: string;
  employeeId: string | null;
  role: string;
  status: string;
  joinedAt: string;
  lastLoginAt: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string;
  createdAt: string;
}

export interface AdminBadge {
  id: string;
  key: string;
  name: string;
  emoji: string;
  description: string;
  isActive: boolean;
}

export interface PendingConfession {
  id: string;
  body: string;
  createdAt: string;
}

export interface SearchResult {
  message: PublicMessage;
  channel: { id: string; slug: string; name: string } | null;
}

export interface PollUpdate {
  messageId: string;
  poll: PublicPoll;
}

export type NotificationLevel = 'ALL' | 'MENTIONS' | 'IMPORTANT' | 'NOTHING';

export interface NotificationPreferences {
  global: NotificationLevel;
  channels: { channelId: string; level: NotificationLevel }[];
}
