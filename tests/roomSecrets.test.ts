import { describe, it, expect } from 'vitest';
import { consumePendingRoomSecret } from '../src/util/roomSecrets';
import { deriveKey } from '../src/util/crypto';

describe('consumePendingRoomSecret', () => {
  it('derives the room key from the pending secret without needing mutable extension state', () => {
    const derived = consumePendingRoomSecret('shared-secret', 'ROOM42');
    expect(derived?.equals(deriveKey('shared-secret', 'ROOM42'))).toBe(true);
  });

  it('returns undefined when no secret was provided', () => {
    expect(consumePendingRoomSecret(undefined, 'ROOM42')).toBeUndefined();
  });
});
