export interface JoinAccessInput {
  roomId: string;
  roomSecretHash?: string;
  secret?: string;
  token?: string;
  tokenRecord?: { roomId: string; createdAt: number };
  now: number;
  tokenTtlMs: number;
  verifySecret: (secret: string, roomId: string, secretHash: string) => Promise<boolean>;
}

export type JoinAccessResult =
  | { ok: true; consumeToken: boolean }
  | { ok: false; code: 'TOKEN_INVALID' | 'ROOM_SECRET_REQUIRED' | 'ROOM_SECRET_INVALID'; message: string };

export async function validateJoinAccess(input: JoinAccessInput): Promise<JoinAccessResult> {
  if (input.token) {
    const validToken = Boolean(
      input.tokenRecord
      && input.tokenRecord.roomId === input.roomId
      && input.now - input.tokenRecord.createdAt <= input.tokenTtlMs
    );
    if (validToken) {
      return { ok: true, consumeToken: true };
    }

    // Accept token-shaped secrets when the room is password-protected.
    if (input.roomSecretHash && await input.verifySecret(input.token, input.roomId, input.roomSecretHash)) {
      return { ok: true, consumeToken: false };
    }

    return {
      ok: false,
      code: 'TOKEN_INVALID',
      message: 'Invalid or expired invite token.'
    };
  }

  if (!input.roomSecretHash) {
    return { ok: true, consumeToken: false };
  }

  if (!input.secret) {
    return {
      ok: false,
      code: 'ROOM_SECRET_REQUIRED',
      message: 'Room requires a secret'
    };
  }

  if (!await input.verifySecret(input.secret, input.roomId, input.roomSecretHash)) {
    return {
      ok: false,
      code: 'ROOM_SECRET_INVALID',
      message: 'Room secret is invalid'
    };
  }

  return { ok: true, consumeToken: false };
}
