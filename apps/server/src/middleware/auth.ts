import type { MiddlewareHandler } from 'hono';
import { createAuthStrategy } from '@adi-mcp/auth';
import type { AppBindings } from '../context.js';

/**
 * Guards the MCP endpoint using the strategy selected by `AUTH_STRATEGY`. On failure it
 * returns a JSON-RPC-shaped error plus a `WWW-Authenticate` challenge, so MCP clients can
 * discover how to authenticate rather than just seeing an opaque 401.
 */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const strategy = createAuthStrategy(c.env, c.get('kv'));
    const result = await strategy.authenticate(c.req.raw, c.env);

    if (!result.ok) {
      c.get('logger').warn('Authentication failed', {
        strategy: strategy.name,
        status: result.status,
      });
      return c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: result.error }, id: null },
        result.status,
        { 'WWW-Authenticate': strategy.challenge(c.req.raw, c.env) },
      );
    }

    c.set('principal', result.principal);
    await next();
    return undefined;
  };
}
