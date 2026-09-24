import { AccessToken } from 'livekit-server-sdk';
import { prisma } from '../../lib/prisma.js';
import { config, isProd } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { toPublicProfile, type PublicProfile } from '../../common/mappers.js';

export type RoomKind = 'voice' | 'video';

export interface ParticipantView {
  profile: PublicProfile;
  state: Record<string, boolean>;
}

export interface RoomView {
  id: string;
  kind: RoomKind;
  name: string;
  isActive: boolean;
  createdAt: string;
  participants: ParticipantView[];
}

function assertKind(kind: string): RoomKind {
  if (kind !== 'voice' && kind !== 'video') throw AppError.notFound('Room');
  return kind;
}

function voiceState(p: { isMuted: boolean; isDeafened: boolean; handRaised: boolean }): Record<string, boolean> {
  return { isMuted: p.isMuted, isDeafened: p.isDeafened, handRaised: p.handRaised };
}
function videoState(p: { cameraOn: boolean; micOn: boolean; screenSharing: boolean; handRaised: boolean }): Record<string, boolean> {
  return { cameraOn: p.cameraOn, micOn: p.micOn, screenSharing: p.screenSharing, handRaised: p.handRaised };
}

export async function listRooms(kindRaw: string): Promise<RoomView[]> {
  const kind = assertKind(kindRaw);
  if (kind === 'voice') {
    const rooms = await prisma.voiceRoom.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { participants: { where: { leftAt: null }, include: { profile: true } } },
    });
    return rooms.map((r) => ({
      id: r.id,
      kind,
      name: r.name,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      participants: r.participants.map((p) => ({ profile: toPublicProfile(p.profile), state: voiceState(p) })),
    }));
  }
  const rooms = await prisma.videoRoom.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: { participants: { where: { leftAt: null }, include: { profile: true } } },
  });
  return rooms.map((r) => ({
    id: r.id,
    kind,
    name: r.name,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    participants: r.participants.map((p) => ({ profile: toPublicProfile(p.profile), state: videoState(p) })),
  }));
}

export async function getRoom(kindRaw: string, roomId: string): Promise<RoomView> {
  const rooms = await listRooms(kindRaw);
  const room = rooms.find((r) => r.id === roomId);
  if (room) return room;
  // Room may be inactive/empty — return a minimal shell.
  const kind = assertKind(kindRaw);
  const base = kind === 'voice'
    ? await prisma.voiceRoom.findUnique({ where: { id: roomId } })
    : await prisma.videoRoom.findUnique({ where: { id: roomId } });
  if (!base) throw AppError.notFound('Room');
  return { id: base.id, kind, name: base.name, isActive: base.isActive, createdAt: base.createdAt.toISOString(), participants: [] };
}

export async function createRoom(kindRaw: string, profileId: string, name: string): Promise<RoomView> {
  const kind = assertKind(kindRaw);
  const trimmed = name.trim() || (kind === 'voice' ? 'Voice room' : 'Video room');
  const room = kind === 'voice'
    ? await prisma.voiceRoom.create({ data: { name: trimmed, createdByProfileId: profileId } })
    : await prisma.videoRoom.create({ data: { name: trimmed, createdByProfileId: profileId } });
  return getRoom(kind, room.id);
}

async function activeParticipant(kind: RoomKind, roomId: string, profileId: string): Promise<string | null> {
  const row = kind === 'voice'
    ? await prisma.voiceRoomParticipant.findFirst({ where: { roomId, profileId, leftAt: null } })
    : await prisma.videoRoomParticipant.findFirst({ where: { roomId, profileId, leftAt: null } });
  return row?.id ?? null;
}

export async function joinRoom(kindRaw: string, roomId: string, profileId: string): Promise<RoomView> {
  const kind = assertKind(kindRaw);
  const existing = await activeParticipant(kind, roomId, profileId);
  if (!existing) {
    if (kind === 'voice') await prisma.voiceRoomParticipant.create({ data: { roomId, profileId } });
    else await prisma.videoRoomParticipant.create({ data: { roomId, profileId } });
  }
  return getRoom(kind, roomId);
}

export async function leaveRoom(kindRaw: string, roomId: string, profileId: string): Promise<void> {
  const kind = assertKind(kindRaw);
  if (kind === 'voice') {
    await prisma.voiceRoomParticipant.updateMany({ where: { roomId, profileId, leftAt: null }, data: { leftAt: new Date() } });
    const remaining = await prisma.voiceRoomParticipant.count({ where: { roomId, leftAt: null } });
    if (remaining === 0) await prisma.voiceRoom.update({ where: { id: roomId }, data: { isActive: false, endedAt: new Date() } });
  } else {
    await prisma.videoRoomParticipant.updateMany({ where: { roomId, profileId, leftAt: null }, data: { leftAt: new Date() } });
    const remaining = await prisma.videoRoomParticipant.count({ where: { roomId, leftAt: null } });
    if (remaining === 0) await prisma.videoRoom.update({ where: { id: roomId }, data: { isActive: false, endedAt: new Date() } });
  }
}

export async function updateState(
  kindRaw: string,
  roomId: string,
  profileId: string,
  patch: Record<string, boolean>,
): Promise<void> {
  const kind = assertKind(kindRaw);
  if (kind === 'voice') {
    const data: Record<string, boolean> = {};
    for (const k of ['isMuted', 'isDeafened', 'handRaised']) if (typeof patch[k] === 'boolean') data[k] = patch[k];
    if (Object.keys(data).length) await prisma.voiceRoomParticipant.updateMany({ where: { roomId, profileId, leftAt: null }, data });
  } else {
    const data: Record<string, boolean> = {};
    for (const k of ['cameraOn', 'micOn', 'screenSharing', 'handRaised']) if (typeof patch[k] === 'boolean') data[k] = patch[k];
    if (Object.keys(data).length) await prisma.videoRoomParticipant.updateMany({ where: { roomId, profileId, leftAt: null }, data });
  }
}

export const roomsService = { listRooms, getRoom, createRoom, joinRoom, leaveRoom, updateState, issueRoomToken };

export interface RoomToken {
  token: string;
  url: string;
  room: string;
  identity: string;
  username: string;
}

/**
 * Guard against a misconfigured SFU. Missing credentials always fail; in
 * production we additionally reject the insecure dev defaults and non-wss URLs
 * (a browser on HTTPS cannot open an insecure `ws://` socket), so operators get
 * a clear, actionable error instead of a silent connection failure.
 */
function assertLiveKitReady(): void {
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    throw AppError.serviceUnavailable('Voice and video rooms are not configured on this server.');
  }
  if (isProd) {
    const insecureUrl = !/^wss:\/\//i.test(config.LIVEKIT_URL);
    const devKeys = config.LIVEKIT_API_KEY === 'devkey' || config.LIVEKIT_API_SECRET === 'secret';
    if (insecureUrl || devKeys) {
      throw AppError.serviceUnavailable(
        'Voice and video rooms are not configured for production. Set LIVEKIT_URL to a wss:// endpoint and use real LiveKit API keys.',
      );
    }
  }
}

/**
 * Mint a LiveKit access token for the room. The participant identity/name are
 * the ANONYMOUS profile id + username only — LiveKit never sees real identity.
 * Also records the join so the lobby participant list stays warm.
 */
export async function issueRoomToken(kindRaw: string, roomId: string, profileId: string): Promise<RoomToken> {
  assertLiveKitReady();
  const kind = assertKind(kindRaw);
  const profile = await prisma.anonymousProfile.findUnique({ where: { id: profileId }, select: { username: true } });
  if (!profile) throw AppError.notFound('Profile');
  await joinRoom(kind, roomId, profileId);

  const room = `${kind}:${roomId}`;
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: profileId,
    name: profile.username,
    ttl: '2h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await at.toJwt();
  return { token, url: config.LIVEKIT_URL, room, identity: profileId, username: profile.username };
}
