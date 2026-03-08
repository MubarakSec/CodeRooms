import { describe, expect, it } from 'vitest';
import { createRoomOperationGuards, getJoinClaimKey } from '../server/roomOperationGuards';

describe('room operation guards', () => {
  it('blocks duplicate create or join operations on the same connection until released', () => {
    const guards = createRoomOperationGuards();

    expect(guards.beginConnectionOperation('socket-1')).toBe(true);
    expect(guards.beginConnectionOperation('socket-1')).toBe(false);

    guards.endConnectionOperation('socket-1');

    expect(guards.beginConnectionOperation('socket-1')).toBe(true);
  });

  it('blocks duplicate join claims for the same room token but allows other rooms', () => {
    const guards = createRoomOperationGuards();
    const claimKey = getJoinClaimKey({ token: 'invite-1', connectionId: 'socket-1' });

    expect(guards.beginJoinClaim('ROOM1', claimKey)).toBe(true);
    expect(guards.beginJoinClaim('ROOM1', claimKey)).toBe(false);
    expect(guards.beginJoinClaim('ROOM2', claimKey)).toBe(true);
  });

  it('blocks duplicate join claims for the same resumed session token', () => {
    const guards = createRoomOperationGuards();
    const claimKey = getJoinClaimKey({ sessionToken: 'session-1', connectionId: 'socket-1' });

    expect(guards.beginJoinClaim('ROOM1', claimKey)).toBe(true);
    expect(guards.beginJoinClaim('ROOM1', claimKey)).toBe(false);

    guards.endJoinClaim('ROOM1', claimKey);

    expect(guards.beginJoinClaim('ROOM1', claimKey)).toBe(true);
  });

  it('falls back to connection-scoped join claims when there is no token or resumed session', () => {
    const claimKey = getJoinClaimKey({ connectionId: 'socket-9' });
    expect(claimKey).toBe('connection:socket-9');
  });
});
