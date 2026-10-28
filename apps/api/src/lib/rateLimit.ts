// A per-instance token bucket. Best effort on the Consumption plan: each instance counts on its
// own, and a new instance starts with full buckets.

interface Bucket {
  tokens: number;
  at: number;
}

const MINUTE_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns 0 when allowed, otherwise the seconds until a token is free. */
  take(key: string): number {
    const t = this.now();
    if (this.buckets.size > 10_000) this.sweep(t);
    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, at: t };
    bucket.tokens = Math.min(
      this.perMinute,
      bucket.tokens + ((t - bucket.at) / MINUTE_MS) * this.perMinute,
    );
    bucket.at = t;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil(((1 - bucket.tokens) / this.perMinute) * 60));
  }

  private sweep(t: number): void {
    for (const [key, bucket] of this.buckets)
      if (t - bucket.at > 2 * MINUTE_MS) this.buckets.delete(key);
  }
}
