import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../server/rateLimiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const limiter = new RateLimiter(10_000, 3, 30_000);
    expect(limiter.isBlocked('a')).toBe(false);
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('blocks after exceeding maxFailures', () => {
    const limiter = new RateLimiter(10_000, 3, 30_000);
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    const blocked = limiter.recordFailure('a');
    expect(blocked).toBe(true);
    expect(limiter.isBlocked('a')).toBe(true);
  });

  it('unblocks after block duration expires', () => {
    const limiter = new RateLimiter(10_000, 3, 30_000);
    for (let i = 0; i < 5; i++) { limiter.recordFailure('a'); }
    expect(limiter.isBlocked('a')).toBe(true);

    vi.advanceTimersByTime(30_001);
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('prunes old failures outside window', () => {
    const limiter = new RateLimiter(5_000, 3, 30_000);
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    vi.advanceTimersByTime(6_000);
    // Old failures should be pruned, so adding 2 more should NOT block
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('reset clears a key completely', () => {
    const limiter = new RateLimiter(10_000, 3, 30_000);
    for (let i = 0; i < 5; i++) { limiter.recordFailure('a'); }
    expect(limiter.isBlocked('a')).toBe(true);
    limiter.reset('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(10_000, 3, 30_000);
    for (let i = 0; i < 5; i++) { limiter.recordFailure('a'); }
    expect(limiter.isBlocked('a')).toBe(true);
    expect(limiter.isBlocked('b')).toBe(false);
  });

  it('cleanup removes stale buckets', () => {
    const limiter = new RateLimiter(5_000, 3, 10_000);
    limiter.recordFailure('a');
    limiter.recordFailure('b');

    vi.advanceTimersByTime(6_000);
    limiter.cleanup();

    // Both should be unblocked and their buckets cleaned
    expect(limiter.isBlocked('a')).toBe(false);
    expect(limiter.isBlocked('b')).toBe(false);
  });

  it('cleanup preserves blocked buckets', () => {
    const limiter = new RateLimiter(5_000, 3, 30_000);
    for (let i = 0; i < 5; i++) { limiter.recordFailure('a'); }
    limiter.recordFailure('b');

    vi.advanceTimersByTime(6_000);
    limiter.cleanup();

    // 'a' was blocked and block hasn't expired yet
    expect(limiter.isBlocked('a')).toBe(true);
  });
});
