import { KV_KEY_PREFIXES } from '@adi-mcp/shared';
import type { KvStore } from './kv-store.js';

export interface RateLimiterOptions {
  readonly maxRequests: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counter backed by KV. KV is eventually consistent, so under heavy concurrent
 * load from a single key the effective limit can overshoot slightly — acceptable for this
 * platform's per-user/per-token traffic and far simpler than a distributed token bucket.
 */
export class RateLimiter {
  constructor(
    private readonly kv: KvStore,
    private readonly options: RateLimiterOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const nowSeconds = Math.floor(this.now() / 1000);
    const windowIndex = Math.floor(nowSeconds / this.options.windowSeconds);
    const kvKey = `${KV_KEY_PREFIXES.rateLimit}:${key}:${windowIndex}`;

    const raw = await this.kv.get(kvKey);
    const count = raw ? Number.parseInt(raw, 10) : 0;

    if (count >= this.options.maxRequests) {
      const windowEnd = (windowIndex + 1) * this.options.windowSeconds;
      return { allowed: false, remaining: 0, retryAfterSeconds: windowEnd - nowSeconds };
    }

    await this.kv.put(kvKey, String(count + 1), {
      expirationTtl: this.options.windowSeconds * 2,
    });

    return {
      allowed: true,
      remaining: this.options.maxRequests - count - 1,
      retryAfterSeconds: 0,
    };
  }
}
