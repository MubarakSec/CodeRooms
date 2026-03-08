export const JOIN_FAILURE_DELAY_MS = 250;

export type JoinFailureReason =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_SECRET_REQUIRED'
  | 'ROOM_SECRET_INVALID'
  | 'TOKEN_INVALID';

export function getJoinFailureResponse(_reason: JoinFailureReason): { code: 'ROOM_ACCESS_DENIED'; message: string } {
  return {
    code: 'ROOM_ACCESS_DENIED',
    message: 'Unable to join room with the provided invite details.'
  };
}
