import type { MiddlewareHandler } from 'hono';
import { RateLimiter } from '@adi-mcp/core';
import type { AppBindings } from '../context.js';

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_SECONDS = 60;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Throttles by authenticated principal when available, falling back to client IP. Must run
 * after auth so an authenticated caller gets its own bucket rather than sharing a NAT'd IP.
 */
export function rateLimit(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const limiter = new RateLimiter(c.get('kv'), {
      maxRequests: parsePositiveInt(c.env.RATE_LIMIT_MAX_REQUESTS, DEFAULT_MAX_REQUESTS),
      windowSeconds: parsePositiveInt(c.env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
    });

    const identity = c.get('principal')?.userId ?? c.req.header('cf-connecting-ip') ?? 'anonymous';
    const result = await limiter.check(identity);

    if (!result.allowed) {
      c.get('logger').warn('Rate limit exceeded', { identity });
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32029, message: 'Rate limit exceeded. Please retry later.' },
          id: null,
        },
        429,
        { 'Retry-After': String(result.retryAfterSeconds) },
      );
    }

    c.header('X-RateLimit-Remaining', String(result.remaining));
    await next();
    return undefined;
  };
}
