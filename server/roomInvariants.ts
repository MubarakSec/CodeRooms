import { Role } from './types';
import { getRestoredOwnerId } from './roomSessions';

export interface RoomInvariantParticipant {
  userId: string;
  role: Role;
  sessionToken: string;
}

export interface RoomInvariantConnection {
  userId: string;
  roomId?: string;
  role?: Role;
}

export interface RoomInvariantRecoverableSession {
  sessionToken: string;
}

export interface RoomInvariantRoom {
  roomId: string;
  ownerId: string;
  ownerSessionToken: string;
  participants: Map<string, RoomInvariantParticipant>;
  connections: Map<string, RoomInvariantConnection>;
  recoverableSessions: Map<string, RoomInvariantRecoverableSession>;
}

export function getRoomInvariantViolations(room: RoomInvariantRoom): string[] {
  const issues: string[] = [];
  const expectedRestoredOwnerId = getRestoredOwnerId(room.ownerSessionToken);
  const activeOwner = room.participants.get(room.ownerId);
  const activeSessions = new Set<string>();
  const rootParticipants = Array.from(room.participants.values()).filter(participant => participant.role === 'root');

  if (!room.recoverableSessions.has(room.ownerSessionToken)) {
    issues.push('owner_recovery_session_missing');
  }

  if (rootParticipants.length > 1) {
    issues.push('multiple_active_roots');
  }

  if (activeOwner) {
    if (activeOwner.role !== 'root') {
      issues.push('owner_is_not_root');
    }
    if (activeOwner.sessionToken !== room.ownerSessionToken) {
      issues.push('owner_session_token_mismatch');
    }
  } else if (room.ownerId !== expectedRestoredOwnerId) {
    issues.push('owner_id_is_neither_active_nor_restored');
  }

  for (const participant of rootParticipants) {
    if (participant.userId !== room.ownerId) {
      issues.push(`root_participant_mismatch:${participant.userId}`);
    }
    if (participant.sessionToken !== room.ownerSessionToken) {
      issues.push(`root_session_token_mismatch:${participant.userId}`);
    }
  }

  for (const [userId, participant] of room.participants) {
    if (participant.userId !== userId) {
      issues.push(`participant_key_mismatch:${userId}`);
    }
    if (activeSessions.has(participant.sessionToken)) {
      issues.push(`duplicate_active_session_token:${participant.sessionToken}`);
    }
    activeSessions.add(participant.sessionToken);

    const connection = room.connections.get(userId);
    if (!connection) {
      issues.push(`participant_missing_connection:${userId}`);
      continue;
    }
    if (connection.userId !== userId) {
      issues.push(`connection_user_mismatch:${userId}`);
    }
    if (connection.roomId !== room.roomId) {
      issues.push(`connection_room_mismatch:${userId}`);
    }
    if (connection.role !== participant.role) {
      issues.push(`connection_role_mismatch:${userId}`);
    }
    if (!room.recoverableSessions.has(participant.sessionToken)) {
      issues.push(`participant_missing_recoverable_session:${participant.sessionToken}`);
    }
  }

  for (const [userId, connection] of room.connections) {
    if (connection.userId !== userId) {
      issues.push(`connection_map_key_mismatch:${userId}`);
    }
    if (connection.roomId !== room.roomId) {
      issues.push(`connection_room_id_mismatch:${userId}`);
    }
    if (!room.participants.has(userId)) {
      issues.push(`connection_missing_participant:${userId}`);
    }
  }

  for (const [sessionToken, recoverableSession] of room.recoverableSessions) {
    if (recoverableSession.sessionToken !== sessionToken) {
      issues.push(`recoverable_session_key_mismatch:${sessionToken}`);
    }
  }

  return issues;
}
