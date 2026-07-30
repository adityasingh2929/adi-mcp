import type { MiddlewareHandler } from 'hono';

/**
 * Baseline security headers for a JSON/SSE API. There is no HTML surface here beyond the
 * OAuth callback pages, so the CSP is deliberately restrictive: no scripts, no framing.
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Cache-Control', 'no-store');
  };
}
