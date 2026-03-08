import { describe, expect, it } from 'vitest';
import {
  getRestoredOwnerId,
  resolveJoinParticipant,
  restoreSessionState,
  toPublicParticipant,
  type ParticipantState
} from '../server/roomSessions';

describe('server room session helpers', () => {
  it('restores owner recovery state without reviving live participants', () => {
    const restored = restoreSessionState({
      ownerSessionToken: 'owner-session',
      recoverableSessions: [[
        'collab-session',
        {
          sessionToken: 'collab-session',
          displayName: 'Casey',
          role: 'collaborator',
          isDirectEditMode: false
        }
      ]]
    });

    expect(restored.ownerId).toBe(getRestoredOwnerId('owner-session'));
    expect(restored.recoverableSessions.size).toBe(1);
    expect(restored.recoverableSessions.get('collab-session')?.displayName).toBe('Casey');
  });

  it('reclaims the root role when the owner session token reconnects', () => {
    const resolved = resolveJoinParticipant({
      userId: 'socket-2',
      displayName: 'Root User',
      mode: 'team',
      activeParticipantCount: 0,
      ownerSessionToken: 'owner-session',
      activeParticipants: [],
      recoverableSessions: new Map(),
      requestedSessionToken: 'owner-session'
    });

    expect(resolved.participant.role).toBe('root');
    expect(resolved.participant.sessionToken).toBe('owner-session');
    expect(resolved.participant.isDirectEditMode).toBe(true);
    expect(resolved.reclaimedSession).toBe(true);
  });

  it('reclaims an existing collaborator session and identifies the stale live user', () => {
    const activeParticipant: ParticipantState = {
      userId: 'socket-1',
      displayName: 'Casey',
      role: 'collaborator',
      isDirectEditMode: true,
      sessionToken: 'collab-session'
    };

    const resolved = resolveJoinParticipant({
      userId: 'socket-2',
      displayName: 'Casey',
      mode: 'team',
      activeParticipantCount: 1,
      ownerSessionToken: 'owner-session',
      activeParticipants: [activeParticipant],
      recoverableSessions: new Map([
        ['collab-session', {
          sessionToken: 'collab-session',
          displayName: 'Casey',
          role: 'collaborator',
          isDirectEditMode: true
        }]
      ]),
      requestedSessionToken: 'collab-session'
    });

    expect(resolved.previousUserId).toBe('socket-1');
    expect(resolved.participant.role).toBe('collaborator');
    expect(resolved.participant.isDirectEditMode).toBe(true);
    expect(resolved.participant.sessionToken).toBe('collab-session');
  });

  it('does not expose session tokens in public participant payloads', () => {
    const publicParticipant = toPublicParticipant({
      userId: 'socket-1',
      displayName: 'Casey',
      role: 'viewer',
      sessionToken: 'secret-session'
    });

    expect(publicParticipant).toEqual({
      userId: 'socket-1',
      displayName: 'Casey',
      role: 'viewer',
      isDirectEditMode: undefined
    });
    expect('sessionToken' in publicParticipant).toBe(false);
  });
});
