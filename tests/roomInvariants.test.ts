import { describe, expect, it } from 'vitest';
import { getRestoredOwnerId } from '../server/roomSessions';
import {
  getRoomInvariantViolations,
  type RoomInvariantConnection,
  type RoomInvariantParticipant,
  type RoomInvariantRecoverableSession,
  type RoomInvariantRoom
} from '../server/roomInvariants';

function participant(overrides: Partial<RoomInvariantParticipant> = {}): RoomInvariantParticipant {
  return {
    userId: overrides.userId ?? 'owner-1',
    role: overrides.role ?? 'root',
    sessionToken: overrides.sessionToken ?? 'owner-session'
  };
}

function connection(overrides: Partial<RoomInvariantConnection> = {}): RoomInvariantConnection {
  return {
    userId: overrides.userId ?? 'owner-1',
    roomId: overrides.roomId ?? 'room-1',
    role: overrides.role ?? 'root'
  };
}

function recoverable(overrides: Partial<RoomInvariantRecoverableSession> = {}): RoomInvariantRecoverableSession {
  return {
    sessionToken: overrides.sessionToken ?? 'owner-session'
  };
}

function room(overrides: Partial<RoomInvariantRoom> = {}): RoomInvariantRoom {
  return {
    roomId: overrides.roomId ?? 'room-1',
    ownerId: overrides.ownerId ?? 'owner-1',
    ownerSessionToken: overrides.ownerSessionToken ?? 'owner-session',
    participants: overrides.participants ?? new Map([
      ['owner-1', participant()]
    ]),
    connections: overrides.connections ?? new Map([
      ['owner-1', connection()]
    ]),
    recoverableSessions: overrides.recoverableSessions ?? new Map([
      ['owner-session', recoverable()]
    ])
  };
}

describe('room membership invariants', () => {
  it('accepts a valid active-owner room state', () => {
    expect(getRoomInvariantViolations(room())).toEqual([]);
  });

  it('accepts a restored-owner room with reconnectable collaborators', () => {
    const ownerSessionToken = 'owner-session';
    const restoredOwnerId = getRestoredOwnerId(ownerSessionToken);
    const validRoom = room({
      ownerId: restoredOwnerId,
      ownerSessionToken,
      participants: new Map([
        ['collab-1', participant({ userId: 'collab-1', role: 'collaborator', sessionToken: 'collab-session' })]
      ]),
      connections: new Map([
        ['collab-1', connection({ userId: 'collab-1', role: 'collaborator' })]
      ]),
      recoverableSessions: new Map([
        ['owner-session', recoverable({ sessionToken: 'owner-session' })],
        ['collab-session', recoverable({ sessionToken: 'collab-session' })]
      ])
    });

    expect(getRoomInvariantViolations(validRoom)).toEqual([]);
  });

  it('flags stale or mismatched live connection state', () => {
    const invalidRoom = room({
      connections: new Map([
        ['owner-1', connection({ roomId: 'wrong-room', role: 'viewer' })],
        ['ghost-1', connection({ userId: 'ghost-1', role: 'viewer' })]
      ])
    });

    expect(getRoomInvariantViolations(invalidRoom)).toEqual(expect.arrayContaining([
      'connection_room_mismatch:owner-1',
      'connection_role_mismatch:owner-1',
      'connection_missing_participant:ghost-1'
    ]));
  });

  it('flags broken owner and session invariants', () => {
    const invalidRoom = room({
      ownerId: 'viewer-1',
      participants: new Map([
        ['owner-1', participant()],
        ['viewer-1', participant({ userId: 'viewer-1', role: 'root', sessionToken: 'other-session' })]
      ]),
      connections: new Map([
        ['owner-1', connection()],
        ['viewer-1', connection({ userId: 'viewer-1', role: 'root' })]
      ]),
      recoverableSessions: new Map([
        ['other-session', recoverable({ sessionToken: 'other-session' })]
      ])
    });

    expect(getRoomInvariantViolations(invalidRoom)).toEqual(expect.arrayContaining([
      'owner_recovery_session_missing',
      'multiple_active_roots',
      'owner_session_token_mismatch',
      'root_participant_mismatch:owner-1',
      'root_session_token_mismatch:viewer-1'
    ]));
  });
});
