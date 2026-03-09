import { describe, expect, it } from 'vitest';

import { NoticeCooldown } from '../src/util/noticeCooldown';

describe('NoticeCooldown', () => {
  it('suppresses repeated notices inside the cooldown window', () => {
    const cooldown = new NoticeCooldown();

    expect(cooldown.shouldShow('warning:new-suggestion', 2000, 1_000)).toBe(true);
    expect(cooldown.shouldShow('warning:new-suggestion', 2000, 2_500)).toBe(false);
    expect(cooldown.shouldShow('warning:new-suggestion', 2000, 3_001)).toBe(true);
  });

  it('tracks cooldowns independently per key', () => {
    const cooldown = new NoticeCooldown();

    expect(cooldown.shouldShow('warning:new-suggestion', 2000, 1_000)).toBe(true);
    expect(cooldown.shouldShow('warning:room-closed', 2000, 1_100)).toBe(true);
    expect(cooldown.shouldShow('warning:new-suggestion', 2000, 1_200)).toBe(false);
  });

  it('clears remembered notices on reset', () => {
    const cooldown = new NoticeCooldown();

    expect(cooldown.shouldShow('info:reviewed', 2000, 1_000)).toBe(true);
    cooldown.clear();
    expect(cooldown.shouldShow('info:reviewed', 2000, 1_100)).toBe(true);
  });
});
