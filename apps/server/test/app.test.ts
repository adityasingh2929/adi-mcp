import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createProviderRegistry } from '../src/providers.js';
import { INITIALIZE_REQUEST, TEST_BEARER_TOKEN, makeEnv, mcpRequest } from './helpers.js';

const app = createApp();

describe('GET /health', () => {
  it('reports ok with provider and tool counts, unauthenticated', async () => {
    const response = await app.fetch(new Request('https://worker.test/health'), makeEnv());

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body.status).toBe('ok');
    expect(body.server).toBe('adi-mcp');
    expect(body.providers).toBeGreaterThan(0);
    expect(body.tools).toBeGreaterThan(0);
  });

  it('sets security headers on every response', async () => {
    const response = await app.fetch(new Request('https://worker.test/health'), makeEnv());

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });

  it('echoes a correlation id back to the caller', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/health', { headers: { 'x-request-id': 'my-trace-id' } }),
      makeEnv(),
    );

    expect(response.headers.get('x-request-id')).toBe('my-trace-id');
  });

  it('generates a correlation id when the caller does not supply one', async () => {
    const response = await app.fetch(new Request('https://worker.test/health'), makeEnv());
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('GET /.well-known/oauth-protected-resource', () => {
  it('advertises the MCP endpoint as the protected resource', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/.well-known/oauth-protected-resource'),
      makeEnv(),
    );

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body.resource).toBe('https://worker.test/mcp');
    expect(body.bearer_methods_supported).toEqual(['header']);
  });
});

describe('CORS', () => {
  it('allows the configured origin', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/health', { headers: { origin: 'https://claude.ai' } }),
      makeEnv(),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://claude.ai');
  });

  it('does not echo an origin that is not allow-listed', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/health', { headers: { origin: 'https://evil.example' } }),
      makeEnv(),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });

  it('honors a wildcard configuration', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/health', { headers: { origin: 'https://anything.test' } }),
      makeEnv({ CORS_ALLOWED_ORIGINS: '*' }),
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('answers preflight with the allowed methods and headers', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/mcp', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://claude.ai',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      }),
      makeEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const response = await app.fetch(new Request('https://worker.test/nope'), makeEnv());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});

describe('GET /providers', () => {
  it('lists every registered provider with its connect URL where applicable', async () => {
    const response = await app.fetch(new Request('https://worker.test/providers'), makeEnv());

    expect(response.status).toBe(200);
    const body = await response.json<{
      providers: { id: string; credentialKind: string; connectUrl: string | null }[];
    }>();

    const ids = body.providers.map((provider) => provider.id);
    expect(ids).toContain('x');
    expect(ids).toContain('linkedin');
    expect(ids).toContain('system');
    expect(ids).toHaveLength(14); // 13 integrations + the built-in system provider

    const x = body.providers.find((provider) => provider.id === 'x')!;
    expect(x.connectUrl).toBe('/providers/x/connect');

    const stripe = body.providers.find((provider) => provider.id === 'stripe')!;
    expect(stripe.connectUrl).toBeNull();
  });
});

describe('provider connect/status/disconnect', () => {
  it('redirects to the provider consent screen when configured', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/x/connect', { redirect: 'manual' }),
      makeEnv({
        X_CLIENT_ID: 'client-id',
        X_CLIENT_SECRET: 'secret',
        X_REDIRECT_URI: 'https://worker.test/providers/x/callback',
      }),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://x.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('404s the connect route for a provider that does not use OAuth', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/stripe/connect'),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });

  it('reports a provider as disconnected before any credential is stored', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/x/status'),
      makeEnv(),
    );

    expect(await response.json()).toEqual({ id: 'x', credentialKind: 'oauth2', connected: false });
  });

  it('404s status for an unknown provider', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/nonexistent/status'),
      makeEnv(),
    );

    expect(response.status).toBe(404);
  });

  it('rejects a callback that carries no code or state', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/x/callback'),
      makeEnv(),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Missing code or state');
  });

  it('surfaces an error the provider returned on the callback', async () => {
    const response = await app.fetch(
      new Request(
        'https://worker.test/providers/x/callback?error=access_denied&error_description=User+declined',
      ),
      makeEnv(),
    );

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Authorization failed');
    expect(html).toContain('User declined');
  });

  it('escapes provider-supplied text in the callback page', async () => {
    const response = await app.fetch(
      new Request(
        'https://worker.test/providers/x/callback?error=x&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      ),
      makeEnv(),
    );

    const html = await response.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects a callback whose state was never issued', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/x/callback?code=abc&state=forged'),
      makeEnv({ X_CLIENT_ID: 'id', X_CLIENT_SECRET: 'secret' }),
    );

    expect(response.status).toBe(400);
  });

  it('disconnects a provider', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/providers/x/disconnect', { method: 'POST' }),
      makeEnv(),
    );

    expect(await response.json()).toEqual({ id: 'x', connected: false });
  });
});

describe('provider registry', () => {
  it('registers every provider without duplicate ids or tool names', () => {
    const registry = createProviderRegistry();

    const ids = registry.getProviders().map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);

    const toolNames = registry.getTools().map((tool) => tool.name);
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('prefixes every tool name with its provider id', () => {
    for (const provider of createProviderRegistry().getProviders()) {
      for (const tool of provider.tools) {
        expect(tool.name.startsWith(`${provider.id}_`)).toBe(true);
      }
    }
  });

  it('gives every tool a description and an input schema', () => {
    for (const tool of createProviderRegistry().getTools()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe('authentication on /mcp', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/mcp', { method: 'POST' }),
      makeEnv(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('rejects a wrong bearer token with 403', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
      }),
      makeEnv(),
    );

    expect(response.status).toBe(403);
  });

  it('returns a JSON-RPC shaped error body on auth failure', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/mcp', { method: 'POST' }),
      makeEnv(),
    );

    const body = await response.json<{ jsonrpc: string; error: { code: number } }>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32001);
  });

  it('fails closed when no bearer token is configured on the server', async () => {
    const response = await app.fetch(
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
      }),
      makeEnv({ MCP_BEARER_TOKEN: undefined }),
    );

    expect(response.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('rejects requests past the configured limit with 429 and Retry-After', async () => {
    const env = makeEnv({ RATE_LIMIT_MAX_REQUESTS: '2', RATE_LIMIT_WINDOW_SECONDS: '60' });
    const request = () => app.fetch(mcpRequest(INITIALIZE_REQUEST), env);

    await request();
    await request();
    const third = await request();

    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBeTruthy();
  });

  it('reports the remaining quota on allowed requests', async () => {
    const response = await app.fetch(
      mcpRequest(INITIALIZE_REQUEST),
      makeEnv({ RATE_LIMIT_MAX_REQUESTS: '10' }),
    );

    expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  it('does not rate-limit unauthenticated health checks', async () => {
    const env = makeEnv({ RATE_LIMIT_MAX_REQUESTS: '1' });
    await app.fetch(new Request('https://worker.test/health'), env);
    const second = await app.fetch(new Request('https://worker.test/health'), env);

    expect(second.status).toBe(200);
  });
});
