import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { BearerTokenAuthStrategy } from '../src/strategies/bearer.js';
import { OAuthAuthStrategy, accessTokenKey } from '../src/strategies/oauth.js';
import { createAuthStrategy } from '../src/index.js';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return overrides as Env;
}

function makeRequest(authorization?: string): Request {
  return new Request('https://worker.example.com/mcp', {
    headers: authorization ? { authorization } : {},
  });
}

describe('BearerTokenAuthStrategy', () => {
  const strategy = new BearerTokenAuthStrategy();

  it('accepts the configured token', async () => {
    const result = await strategy.authenticate(
      makeRequest('Bearer secret-token'),
      makeEnv({ MCP_BEARER_TOKEN: 'secret-token' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.userId).toBe('default');
      expect(result.principal.scopes).toContain('mcp:full');
    }
  });

  it('accepts a lowercase bearer scheme', async () => {
    const result = await strategy.authenticate(
      makeRequest('bearer secret-token'),
      makeEnv({ MCP_BEARER_TOKEN: 'secret-token' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a wrong token with 403', async () => {
    const result = await strategy.authenticate(
      makeRequest('Bearer wrong-token'),
      makeEnv({ MCP_BEARER_TOKEN: 'secret-token' }),
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects a missing Authorization header with 401', async () => {
    const result = await strategy.authenticate(
      makeRequest(),
      makeEnv({ MCP_BEARER_TOKEN: 'secret-token' }),
    );

    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a non-Bearer scheme with 401', async () => {
    const result = await strategy.authenticate(
      makeRequest('Basic dXNlcjpwYXNz'),
      makeEnv({ MCP_BEARER_TOKEN: 'secret-token' }),
    );

    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('fails closed when MCP_BEARER_TOKEN is not configured', async () => {
    const result = await strategy.authenticate(makeRequest('Bearer anything'), makeEnv());
    expect(result).toMatchObject({ ok: false, status: 401 });
    if (!result.ok) expect(result.error).toContain('misconfigured');
  });

  it('advertises the protected-resource metadata URL in its challenge', () => {
    const challenge = strategy.challenge(makeRequest(), makeEnv());
    expect(challenge).toContain('Bearer realm="adi-mcp"');
    expect(challenge).toContain('/.well-known/oauth-protected-resource');
  });
});

describe('OAuthAuthStrategy', () => {
  it('accepts a valid unexpired token stored in KV', async () => {
    const kv = new InMemoryKvStore();
    const now = 1_000_000;
    await kv.put(
      await accessTokenKey('valid-token'),
      JSON.stringify({
        userId: 'user-42',
        scopes: ['mcp:read'],
        clientId: 'client-1',
        expiresAt: now + 60_000,
      }),
    );

    const strategy = new OAuthAuthStrategy(kv, () => now);
    const result = await strategy.authenticate(makeRequest('Bearer valid-token'), makeEnv());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.userId).toBe('user-42');
      expect(result.principal.claims?.clientId).toBe('client-1');
    }
  });

  it('rejects an unknown token', async () => {
    const strategy = new OAuthAuthStrategy(new InMemoryKvStore());
    const result = await strategy.authenticate(makeRequest('Bearer nope'), makeEnv());
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an expired token', async () => {
    const kv = new InMemoryKvStore();
    const now = 1_000_000;
    await kv.put(
      await accessTokenKey('expired-token'),
      JSON.stringify({
        userId: 'user-42',
        scopes: [],
        clientId: 'client-1',
        expiresAt: now - 1,
      }),
    );

    const strategy = new OAuthAuthStrategy(kv, () => now);
    const result = await strategy.authenticate(makeRequest('Bearer expired-token'), makeEnv());

    expect(result).toMatchObject({ ok: false, status: 401 });
    if (!result.ok) expect(result.error).toContain('expired');
  });

  it('stores tokens hashed, not in plaintext', async () => {
    const key = await accessTokenKey('my-secret-token');
    expect(key).not.toContain('my-secret-token');
    expect(key).toMatch(/^mcp-token:[0-9a-f]{64}$/);
  });

  it('rejects a missing Authorization header', async () => {
    const strategy = new OAuthAuthStrategy(new InMemoryKvStore());
    expect(await strategy.authenticate(makeRequest(), makeEnv())).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

describe('createAuthStrategy', () => {
  it('returns the bearer strategy by default', () => {
    expect(createAuthStrategy(makeEnv(), new InMemoryKvStore()).name).toBe('bearer');
  });

  it('returns the oauth2 strategy when AUTH_STRATEGY=oauth2', () => {
    const strategy = createAuthStrategy(
      makeEnv({ AUTH_STRATEGY: 'oauth2' }),
      new InMemoryKvStore(),
    );
    expect(strategy.name).toBe('oauth2');
  });
});
