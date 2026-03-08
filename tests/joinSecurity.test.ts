import { describe, expect, it } from 'vitest';
import { getJoinFailureResponse, JOIN_FAILURE_DELAY_MS } from '../server/joinSecurity';

describe('join security hardening', () => {
  it('uses the same external failure response for room lookup and credential failures', () => {
    expect(getJoinFailureResponse('ROOM_NOT_FOUND')).toEqual({
      code: 'ROOM_ACCESS_DENIED',
      message: 'Unable to join room with the provided invite details.'
    });
    expect(getJoinFailureResponse('ROOM_SECRET_INVALID')).toEqual({
      code: 'ROOM_ACCESS_DENIED',
      message: 'Unable to join room with the provided invite details.'
    });
    expect(getJoinFailureResponse('TOKEN_INVALID')).toEqual({
      code: 'ROOM_ACCESS_DENIED',
      message: 'Unable to join room with the provided invite details.'
    });
  });

  it('applies a non-zero delay to failed joins to slow brute-force attempts', () => {
    expect(JOIN_FAILURE_DELAY_MS).toBeGreaterThan(0);
  });
});
