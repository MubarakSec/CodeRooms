import { describe, expect, it, vi } from 'vitest';
import { validateJoinAccess } from '../server/joinAccess';

describe('join access validation', () => {
  it('accepts valid single-use invite tokens', async () => {
    const result = await validateJoinAccess({
      roomId: 'ROOM1',
      token: 'token-1',
      tokenRecord: { roomId: 'ROOM1', createdAt: 100 },
      now: 200,
      tokenTtlMs: 1000,
      verifySecret: vi.fn(async () => false)
    });

    expect(result).toEqual({ ok: true, consumeToken: true });
  });

  it('falls back to password verification for token-shaped secrets', async () => {
    const verifySecret = vi.fn(async () => true);

    const result = await validateJoinAccess({
      roomId: 'ROOM1',
      roomSecretHash: 'hash',
      token: '0123456789abcdef0123456789abcdef',
      tokenRecord: undefined,
      now: 200,
      tokenTtlMs: 1000,
      verifySecret
    });

    expect(result).toEqual({ ok: true, consumeToken: false });
    expect(verifySecret).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef', 'ROOM1', 'hash');
  });

  it('requires a secret for protected rooms without credentials', async () => {
    const result = await validateJoinAccess({
      roomId: 'ROOM1',
      roomSecretHash: 'hash',
      now: 200,
      tokenTtlMs: 1000,
      verifySecret: vi.fn(async () => false)
    });

    expect(result).toEqual({
      ok: false,
      code: 'ROOM_SECRET_REQUIRED',
      message: 'Room requires a secret'
    });
  });

  it('rejects expired invite tokens when they are not valid secrets', async () => {
    const result = await validateJoinAccess({
      roomId: 'ROOM1',
      roomSecretHash: 'hash',
      token: 'token-1',
      tokenRecord: { roomId: 'ROOM1', createdAt: 0 },
      now: 5000,
      tokenTtlMs: 1000,
      verifySecret: vi.fn(async () => false)
    });

    expect(result).toEqual({
      ok: false,
      code: 'TOKEN_INVALID',
      message: 'Invalid or expired invite token.'
    });
  });
});
