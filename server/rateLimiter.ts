interface Bucket {
  failures: number[];
  blockedUntil?: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxFailures: number,
    private readonly blockMs: number
  ) {}

  isBlocked(key: string): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return false;
    }
    this.prune(bucket);
    if (!bucket.blockedUntil) {
      return false;
    }
    if (bucket.blockedUntil <= Date.now()) {
      bucket.blockedUntil = undefined;
      bucket.failures = [];
      return false;
    }
    return true;
  }

  recordFailure(key: string): boolean {
    const bucket = this.buckets.get(key) ?? { failures: [] };
    this.prune(bucket);
    bucket.failures.push(Date.now());
    if (bucket.failures.length > this.maxFailures) {
      bucket.blockedUntil = Date.now() + this.blockMs;
    }
    this.buckets.set(key, bucket);
    return Boolean(bucket.blockedUntil && bucket.blockedUntil > Date.now());
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Remove stale buckets that have no recent failures and are not blocked. */
  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      this.prune(bucket);
      const isBlocked = bucket.blockedUntil !== undefined && bucket.blockedUntil > now;
      if (bucket.failures.length === 0 && !isBlocked) {
        this.buckets.delete(key);
      }
    }
  }

  private prune(bucket: Bucket): void {
    const cutoff = Date.now() - this.windowMs;
    bucket.failures = bucket.failures.filter(ts => ts >= cutoff);
  }
}
