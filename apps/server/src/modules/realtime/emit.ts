import type { PublicMessage } from '../../common/mappers.js';

/**
 * The real-time fan-out contract, kept dependency-free so service-layer code can
 * emit without importing the Socket.IO gateway (which would create an import
 * cycle: messages → notifications → gateway → messages). The gateway installs
 * the live implementation via {@link setRealtime}; until then emits are no-ops.
 */

export interface ReactionUpdatePayload {
  messageId: string;
  counts: { emoji: string; count: number }[];
  actorProfileId: string;
  emoji: string;
  op: 'add' | 'remove';
}

export interface RealtimeGateway {
  emitMessageNew(channelId: string, message: PublicMessage): void;
  emitMessageUpdated(channelId: string, message: PublicMessage): void;
  emitMessageDeleted(channelId: string, messageId: string): void;
  emitReactionUpdate(channelId: string, payload: ReactionUpdatePayload): void;
  /** Live poll vote update to a channel room. */
  emitPollUpdate(channelId: string, payload: { messageId: string; poll: unknown }): void;
  /** Deliver a notification to a single recipient (their personal room). */
  emitNotification(recipientProfileId: string, notification: unknown): void;
  /** Deliver a DM message to each participant's personal room. */
  emitDmMessage(recipientProfileIds: string[], message: PublicMessage): void;
}

/** Used before the real gateway is attached (and in tests) so emits are no-ops. */
export function createNoopRealtime(): RealtimeGateway {
  return {
    emitMessageNew: () => undefined,
    emitMessageUpdated: () => undefined,
    emitMessageDeleted: () => undefined,
    emitReactionUpdate: () => undefined,
    emitPollUpdate: () => undefined,
    emitNotification: () => undefined,
    emitDmMessage: () => undefined,
  };
}

let currentGateway: RealtimeGateway = createNoopRealtime();

/** Service-layer entry point for fan-out. */
export function getRealtime(): RealtimeGateway {
  return currentGateway;
}

/** Installed once by the Socket.IO gateway at startup. */
export function setRealtime(gateway: RealtimeGateway): void {
  currentGateway = gateway;
}
