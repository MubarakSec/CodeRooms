"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
class RateLimiter {
    constructor(windowMs, maxFailures, blockMs) {
        this.windowMs = windowMs;
        this.maxFailures = maxFailures;
        this.blockMs = blockMs;
        this.buckets = new Map();
    }
    isBlocked(key) {
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
    recordFailure(key) {
        const bucket = this.buckets.get(key) ?? { failures: [] };
        this.prune(bucket);
        bucket.failures.push(Date.now());
        if (bucket.failures.length > this.maxFailures) {
            bucket.blockedUntil = Date.now() + this.blockMs;
        }
        this.buckets.set(key, bucket);
        return Boolean(bucket.blockedUntil && bucket.blockedUntil > Date.now());
    }
    reset(key) {
        this.buckets.delete(key);
    }
    prune(bucket) {
        const cutoff = Date.now() - this.windowMs;
        bucket.failures = bucket.failures.filter(ts => ts >= cutoff);
    }
}
exports.RateLimiter = RateLimiter;
