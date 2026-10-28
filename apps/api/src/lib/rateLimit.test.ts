import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit';

describe('RateLimiter', () => {
  it('allows a burst up to the limit, then refills over the minute', () => {
    let now = 0;
    const limiter = new RateLimiter(120, () => now);
    for (let i = 0; i < 120; i++) expect(limiter.take('coach')).toBe(0);
    expect(limiter.take('coach')).toBe(1);
    now += 500; // half a second refills one token at 120 a minute
    expect(limiter.take('coach')).toBe(0);
    expect(limiter.take('coach')).toBeGreaterThan(0);
  });

  it('counts each key separately and says how long to wait', () => {
    let now = 0;
    const limiter = new RateLimiter(2, () => now);
    limiter.take('a');
    limiter.take('a');
    expect(limiter.take('a')).toBe(30);
    expect(limiter.take('b')).toBe(0);
    now += 30_000;
    expect(limiter.take('a')).toBe(0);
  });
});
