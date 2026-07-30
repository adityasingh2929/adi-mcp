import type { MiddlewareHandler } from 'hono';
import { HTTP_HEADERS } from '@adi-mcp/shared';
import { CloudflareKvStore, createLogger } from '@adi-mcp/core';
import type { AppBindings } from '../context.js';

/**
 * Seeds every request with a correlation id, a logger bound to it, and a KV store handle.
 * Runs first so that everything downstream — including error handlers — can log coherently.
 */
export function requestContext(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const requestId = c.req.header(HTTP_HEADERS.requestId) ?? crypto.randomUUID();

    c.set('requestId', requestId);
    c.set(
      'logger',
      createLogger({
        level: c.env.LOG_LEVEL ?? 'info',
        bindings: { service: 'adi-mcp', requestId, method: c.req.method, path: c.req.path },
      }),
    );
    c.set('kv', new CloudflareKvStore(c.env.ADI_MCP_KV));

    await next();

    c.header(HTTP_HEADERS.requestId, requestId);
  };
}
