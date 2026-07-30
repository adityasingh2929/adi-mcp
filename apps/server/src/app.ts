import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { StreamableHTTPTransport } from '@hono/mcp';
import { HEALTH_ENDPOINT_PATH, MCP_ENDPOINT_PATH } from '@adi-mcp/shared';
import type { ProviderRegistry } from '@adi-mcp/core';
import { buildExecutionContext, type AppBindings } from './context.js';
import { createMcpServer, SERVER_INFO } from './mcp-server.js';
import { createProviderRegistry } from './providers.js';
import { createProviderRoutes } from './routes/providers.js';
import { requireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestContext } from './middleware/request-context.js';
import { securityHeaders } from './middleware/security-headers.js';

const DEFAULT_ALLOWED_ORIGINS = ['https://claude.ai'];

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Builds the Worker's Hono app. Takes the registry as a parameter so tests can supply a
 * narrower set of providers instead of booting all thirteen.
 */
export function createApp(registry: ProviderRegistry = createProviderRegistry()) {
  const app = new Hono<AppBindings>();

  app.use('*', requestContext());
  app.use('*', securityHeaders());

  app.use(
    '*',
    cors({
      // Resolved per request because the allow-list comes from the Worker's env, which is
      // only available once a request is in flight.
      origin: (origin, c: Context<AppBindings>) => {
        const allowed = parseAllowedOrigins(c.env.CORS_ALLOWED_ORIGINS);
        if (allowed.includes('*')) return '*';
        return allowed.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version'],
      // Clients need to read the session id the transport assigns.
      exposeHeaders: ['Mcp-Session-Id', 'X-Request-Id'],
      maxAge: 86400,
    }),
  );

  app.get(HEALTH_ENDPOINT_PATH, (c) =>
    c.json({
      status: 'ok',
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      providers: registry.getProviders().length,
      tools: registry.getTools().length,
      timestamp: new Date().toISOString(),
    }),
  );

  // Advertises how to authenticate, per RFC 9728. MCP clients fetch this after a 401.
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      resource: `${origin}${MCP_ENDPOINT_PATH}`,
      authorization_servers: [origin],
      scopes_supported: ['mcp:full'],
      bearer_methods_supported: ['header'],
    });
  });

  app.route('/providers', createProviderRoutes(registry));

  // Auth must run before the rate limiter so each principal gets its own bucket.
  app.use(MCP_ENDPOINT_PATH, requireAuth());
  app.use(MCP_ENDPOINT_PATH, rateLimit());

  app.all(MCP_ENDPOINT_PATH, async (c) => {
    const ctx = buildExecutionContext(
      c.env,
      { requestId: c.get('requestId'), logger: c.get('logger'), kv: c.get('kv') },
      c.get('principal')?.userId ?? 'default',
    );

    // Stateless: a Workers isolate cannot be relied on to survive between requests, so each
    // request gets its own server + transport pair rather than a resumable session.
    const server = createMcpServer(registry, ctx);
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });

    // The transport owns the server's lifetime: for SSE responses the body streams *after*
    // handleRequest resolves, so closing the server here would truncate it. `onclose` fires
    // once the transport itself is done.
    transport.onclose = () => {
      void server.close();
    };

    await server.connect(transport);

    return (await transport.handleRequest(c)) ?? c.body(null, 204);
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    c.get('logger')?.error('Unhandled request error', {
      error: error.message,
      stack: error.stack,
    });
    // Never leak internals to the caller; the detail is in the structured log above.
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
