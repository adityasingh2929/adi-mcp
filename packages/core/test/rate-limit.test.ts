import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '../src/kv-store.js';
import { RateLimiter } from '../src/rate-limit.js';

describe('RateLimiter', () => {
  it('allows requests under the limit and decrements remaining', async () => {
    const kv = new InMemoryKvStore();
    const limiter = new RateLimiter(kv, { maxRequests: 3, windowSeconds: 60 });

    const first = await limiter.check('user-1');
    expect(first).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });

    const second = await limiter.check('user-1');
    expect(second.remaining).toBe(1);
  });

  it('denies requests once the limit is reached, with a retryAfterSeconds', async () => {
    const now = 0;
    const kv = new InMemoryKvStore(() => now);
    const limiter = new RateLimiter(kv, { maxRequests: 2, windowSeconds: 60 }, () => now);

    await limiter.check('user-1');
    await limiter.check('user-1');
    const third = await limiter.check('user-1');

    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('tracks separate counters per key', async () => {
    const kv = new InMemoryKvStore();
    const limiter = new RateLimiter(kv, { maxRequests: 1, windowSeconds: 60 });

    const userA = await limiter.check('user-a');
    const userB = await limiter.check('user-b');

    expect(userA.allowed).toBe(true);
    expect(userB.allowed).toBe(true);
  });

  it('resets once a new window starts', async () => {
    let now = 0;
    const limiter = new RateLimiter(
      new InMemoryKvStore(() => now),
      { maxRequests: 1, windowSeconds: 10 },
      () => now,
    );

    expect((await limiter.check('user-1')).allowed).toBe(true);
    expect((await limiter.check('user-1')).allowed).toBe(false);

    now += 11_000; // advance past the window
    expect((await limiter.check('user-1')).allowed).toBe(true);
  });
});
