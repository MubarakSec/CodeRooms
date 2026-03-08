import { v4 as uuidv4 } from 'uuid';
import { Participant, Role, RoomMode } from './types';

export interface ParticipantState extends Participant {
  sessionToken: string;
}

export interface RecoverableParticipantState {
  sessionToken: string;
  displayName: string;
  role: Role;
  isDirectEditMode?: boolean;
}

export interface LegacyPersistedParticipantState {
  sessionToken?: string;
  displayName: string;
  role: Role;
  isDirectEditMode?: boolean;
}

export interface RestoredSessionState {
  ownerId: string;
  ownerSessionToken: string;
  recoverableSessions: Map<string, RecoverableParticipantState>;
}

export interface ResolveJoinParticipantOptions {
  userId: string;
  displayName: string;
  mode: RoomMode;
  activeParticipantCount: number;
  ownerSessionToken: string;
  activeParticipants: Iterable<ParticipantState>;
  recoverableSessions: ReadonlyMap<string, RecoverableParticipantState>;
  requestedSessionToken?: string;
}

export interface ResolveJoinParticipantResult {
  participant: ParticipantState;
  previousUserId?: string;
  reclaimedSession: boolean;
}

const RESTORED_OWNER_PREFIX = 'restored-owner:';

export function getRestoredOwnerId(ownerSessionToken: string): string {
  return `${RESTORED_OWNER_PREFIX}${ownerSessionToken}`;
}

export function toPublicParticipant(participant: ParticipantState): Participant {
  return {
    userId: participant.userId,
    displayName: participant.displayName,
    role: participant.role,
    isDirectEditMode: participant.isDirectEditMode
  };
}

export function toRecoverableParticipant(participant: ParticipantState): RecoverableParticipantState {
  return {
    sessionToken: participant.sessionToken,
    displayName: participant.displayName,
    role: participant.role,
    isDirectEditMode: participant.isDirectEditMode
  };
}

export function restoreSessionState(options: {
  ownerSessionToken?: string;
  legacyOwnerId?: string;
  recoverableSessions?: Iterable<[string, RecoverableParticipantState]>;
  legacyParticipants?: Iterable<[string, LegacyPersistedParticipantState]>;
}): RestoredSessionState {
  const ownerSessionToken = normalizeOwnerSessionToken(options.ownerSessionToken, options.legacyOwnerId);
  const recoverableSessions = new Map<string, RecoverableParticipantState>();

  if (options.recoverableSessions) {
    for (const [sessionToken, participant] of options.recoverableSessions) {
      if (!sessionToken || !participant) {
        continue;
      }
      recoverableSessions.set(sessionToken, {
        sessionToken,
        displayName: participant.displayName,
        role: participant.role,
        isDirectEditMode: participant.isDirectEditMode
      });
    }
  } else if (options.legacyParticipants) {
    for (const [, participant] of options.legacyParticipants) {
      if (!participant?.sessionToken) {
        continue;
      }
      recoverableSessions.set(participant.sessionToken, {
        sessionToken: participant.sessionToken,
        displayName: participant.displayName,
        role: participant.role,
        isDirectEditMode: participant.isDirectEditMode
      });
    }
  }

  return {
    ownerId: getRestoredOwnerId(ownerSessionToken),
    ownerSessionToken,
    recoverableSessions
  };
}

export function createOwnerParticipant(userId: string, displayName: string): ParticipantState {
  return {
    userId,
    displayName,
    role: 'root',
    isDirectEditMode: true,
    sessionToken: uuidv4()
  };
}

export function resolveJoinParticipant(options: ResolveJoinParticipantOptions): ResolveJoinParticipantResult {
  const reclaimed = options.requestedSessionToken
    ? options.recoverableSessions.get(options.requestedSessionToken)
    : undefined;
  const previousParticipant = options.requestedSessionToken
    ? findActiveParticipantBySessionToken(options.activeParticipants, options.requestedSessionToken)
    : undefined;

  const sessionToken = reclaimed?.sessionToken
    ?? (options.requestedSessionToken === options.ownerSessionToken ? options.ownerSessionToken : uuidv4());

  const role = options.requestedSessionToken === options.ownerSessionToken
    ? 'root'
    : reclaimed?.role ?? getDefaultRole(options.mode, options.activeParticipantCount);

  const participant: ParticipantState = {
    userId: options.userId,
    displayName: options.displayName,
    role,
    sessionToken
  };

  if (role === 'root') {
    participant.isDirectEditMode = true;
  } else if (role === 'collaborator') {
    participant.isDirectEditMode = reclaimed?.isDirectEditMode ?? false;
  }

  return {
    participant,
    previousUserId: previousParticipant?.userId,
    reclaimedSession: Boolean(reclaimed || options.requestedSessionToken === options.ownerSessionToken)
  };
}

function findActiveParticipantBySessionToken(
  participants: Iterable<ParticipantState>,
  sessionToken: string
): ParticipantState | undefined {
  for (const participant of participants) {
    if (participant.sessionToken === sessionToken) {
      return participant;
    }
  }
  return undefined;
}

function normalizeOwnerSessionToken(ownerSessionToken?: string, legacyOwnerId?: string): string {
  const trimmedOwnerSessionToken = ownerSessionToken?.trim();
  if (trimmedOwnerSessionToken) {
    return trimmedOwnerSessionToken;
  }
  const trimmedLegacyOwnerId = legacyOwnerId?.trim();
  if (trimmedLegacyOwnerId) {
    return trimmedLegacyOwnerId;
  }
  return uuidv4();
}

function getDefaultRole(mode: RoomMode, activeParticipantCount: number): Role {
  const isLargeRoom = activeParticipantCount >= 40;
  return mode === 'classroom' || isLargeRoom ? 'viewer' : 'collaborator';
}
