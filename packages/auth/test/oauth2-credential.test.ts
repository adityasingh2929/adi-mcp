import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, InMemoryKvStore, UpstreamApiError, createLogger } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { CredentialStore } from '../src/credential-store.js';
import { OAuth2CredentialProvider, type OAuth2Config } from '../src/credentials/oauth2.js';
import type { CredentialContext } from '../src/types.js';

const config: OAuth2Config = {
  providerId: 'x',
  authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
  tokenEndpoint: 'https://api.x.com/2/oauth2/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://worker.example.com/providers/x/callback',
  scopes: ['tweet.read', 'tweet.write'],
  usePkce: true,
  tokenAuthMethod: 'basic',
};

function makeContext(kv = new InMemoryKvStore()): CredentialContext {
  return {
    userId: 'user-1',
    env: {} as Env,
    kv,
    logger: createLogger({ level: 'error' }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

/** Reads the form-encoded body the provider POSTed to the token endpoint. */
function tokenRequestBody(fetchMock: FetchMock, callIndex = 0): URLSearchParams {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  return new URLSearchParams(init?.body ?? '');
}

/** Reads the headers the provider sent to the token endpoint. */
function tokenRequestHeaders(fetchMock: FetchMock, callIndex = 0): Record<string, string> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as
    { headers?: Record<string, string> } | undefined;
  return init?.headers ?? {};
}

describe('OAuth2CredentialProvider.buildAuthorizationUrl', () => {
  it('builds a PKCE authorization URL with all required params', async () => {
    const kv = new InMemoryKvStore();
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv));

    const url = new URL(await provider.buildAuthorizationUrl(makeContext(kv)));

    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('scope')).toBe('tweet.read tweet.write');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('persists the pending authorization under the state key', async () => {
    const kv = new InMemoryKvStore();
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv));

    const url = new URL(await provider.buildAuthorizationUrl(makeContext(kv)));
    const state = url.searchParams.get('state');

    const stored = await kv.get(`oauth-state:x:${state}`);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ userId: 'user-1' });
  });

  it('omits PKCE params when usePkce is false', async () => {
    const kv = new InMemoryKvStore();
    const provider = new OAuth2CredentialProvider(
      { ...config, usePkce: false },
      new CredentialStore(kv),
    );

    const url = new URL(await provider.buildAuthorizationUrl(makeContext(kv)));
    expect(url.searchParams.get('code_challenge')).toBeNull();
  });

  it('appends extraAuthorizationParams', async () => {
    const kv = new InMemoryKvStore();
    const provider = new OAuth2CredentialProvider(
      { ...config, extraAuthorizationParams: { access_type: 'offline', prompt: 'consent' } },
      new CredentialStore(kv),
    );

    const url = new URL(await provider.buildAuthorizationUrl(makeContext(kv)));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});

describe('OAuth2CredentialProvider.handleCallback', () => {
  it('exchanges the code for tokens and stores the credential', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-abc',
        refresh_token: 'refresh-xyz',
        expires_in: 7200,
        scope: 'tweet.read tweet.write',
      }),
    );
    const now = 1_000_000;
    const provider = new OAuth2CredentialProvider(config, store, fetchMock, () => now);

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));
    const state = url.searchParams.get('state')!;

    const credential = await provider.handleCallback('auth-code', state, ctx);

    expect(credential.accessToken).toBe('access-abc');
    expect(credential.refreshToken).toBe('refresh-xyz');
    expect(credential.expiresAt).toBe(now + 7_200_000);
    expect(await store.load('x', 'user-1')).toEqual(credential);
  });

  it('sends the PKCE code_verifier in the token request', async () => {
    const kv = new InMemoryKvStore();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a' }));
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv), fetchMock);

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));
    await provider.handleCallback('auth-code', url.searchParams.get('state')!, ctx);

    const body = tokenRequestBody(fetchMock);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBeTruthy();
  });

  it('uses HTTP Basic auth at the token endpoint when configured', async () => {
    const kv = new InMemoryKvStore();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a' }));
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv), fetchMock);

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));
    await provider.handleCallback('code', url.searchParams.get('state')!, ctx);

    const headers = tokenRequestHeaders(fetchMock);
    expect(headers.authorization).toBe(`Basic ${btoa('client-id:client-secret')}`);
  });

  it('sends credentials in the body when tokenAuthMethod is body', async () => {
    const kv = new InMemoryKvStore();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a' }));
    const provider = new OAuth2CredentialProvider(
      { ...config, tokenAuthMethod: 'body' },
      new CredentialStore(kv),
      fetchMock,
    );

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));
    await provider.handleCallback('code', url.searchParams.get('state')!, ctx);

    const body = tokenRequestBody(fetchMock);
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
  });

  it('rejects an unknown state (CSRF protection)', async () => {
    const provider = new OAuth2CredentialProvider(
      config,
      new CredentialStore(new InMemoryKvStore()),
    );

    await expect(provider.handleCallback('code', 'forged-state', makeContext())).rejects.toThrow(
      UpstreamApiError,
    );
  });

  it('consumes the state so a callback cannot be replayed', async () => {
    const kv = new InMemoryKvStore();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a' }));
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv), fetchMock);

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));
    const state = url.searchParams.get('state')!;

    await provider.handleCallback('code', state, ctx);
    await expect(provider.handleCallback('code', state, ctx)).rejects.toThrow(UpstreamApiError);
  });

  it('surfaces a token-endpoint error as UpstreamApiError', async () => {
    const kv = new InMemoryKvStore();
    const fetchMock = vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 }));
    const provider = new OAuth2CredentialProvider(config, new CredentialStore(kv), fetchMock);

    const ctx = makeContext(kv);
    const url = new URL(await provider.buildAuthorizationUrl(ctx));

    await expect(
      provider.handleCallback('bad-code', url.searchParams.get('state')!, ctx),
    ).rejects.toThrow(UpstreamApiError);
  });
});

describe('OAuth2CredentialProvider.getCredential', () => {
  it('throws AuthRequiredError when the provider is not connected', async () => {
    const provider = new OAuth2CredentialProvider(
      config,
      new CredentialStore(new InMemoryKvStore()),
    );
    await expect(provider.getCredential(makeContext())).rejects.toThrow(AuthRequiredError);
  });

  it('returns a valid unexpired credential without refreshing', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const now = 1_000_000;
    await store.save('x', 'user-1', {
      kind: 'oauth2',
      accessToken: 'still-good',
      expiresAt: now + 3_600_000,
      refreshToken: 'refresh',
    });

    const fetchMock = vi.fn();
    const provider = new OAuth2CredentialProvider(config, store, fetchMock, () => now);

    const credential = await provider.getCredential(makeContext(kv));

    expect(credential.accessToken).toBe('still-good');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired credential and persists the new one', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const now = 1_000_000;
    await store.save('x', 'user-1', {
      kind: 'oauth2',
      accessToken: 'stale',
      expiresAt: now - 1000,
      refreshToken: 'refresh-token',
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'fresh', expires_in: 7200 }));
    const provider = new OAuth2CredentialProvider(config, store, fetchMock, () => now);

    const credential = await provider.getCredential(makeContext(kv));

    expect(credential.accessToken).toBe('fresh');
    expect(credential.expiresAt).toBe(now + 7_200_000);
    expect((await store.load('x', 'user-1'))?.accessToken).toBe('fresh');

    const body = tokenRequestBody(fetchMock);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
  });

  it('carries the old refresh token forward when the provider does not rotate it', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const now = 1_000_000;
    await store.save('x', 'user-1', {
      kind: 'oauth2',
      accessToken: 'stale',
      expiresAt: now - 1000,
      refreshToken: 'original-refresh',
    });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'fresh' }));
    const provider = new OAuth2CredentialProvider(config, store, fetchMock, () => now);

    expect((await provider.getCredential(makeContext(kv))).refreshToken).toBe('original-refresh');
  });

  it('refreshes proactively within the clock-skew window', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const now = 1_000_000;
    // Expires in 30s — inside the 60s skew window, so it should still refresh.
    await store.save('x', 'user-1', {
      kind: 'oauth2',
      accessToken: 'about-to-expire',
      expiresAt: now + 30_000,
      refreshToken: 'refresh',
    });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'fresh' }));
    const provider = new OAuth2CredentialProvider(config, store, fetchMock, () => now);

    expect((await provider.getCredential(makeContext(kv))).accessToken).toBe('fresh');
  });

  it('throws AuthRequiredError when expired with no refresh token', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const now = 1_000_000;
    await store.save('x', 'user-1', { kind: 'oauth2', accessToken: 'stale', expiresAt: now - 1 });

    const provider = new OAuth2CredentialProvider(config, store, vi.fn(), () => now);
    await expect(provider.getCredential(makeContext(kv))).rejects.toThrow(AuthRequiredError);
  });

  it('treats a credential without expiresAt as non-expiring', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    await store.save('x', 'user-1', { kind: 'oauth2', accessToken: 'no-expiry' });

    const fetchMock = vi.fn();
    const provider = new OAuth2CredentialProvider(config, store, fetchMock);

    expect((await provider.getCredential(makeContext(kv))).accessToken).toBe('no-expiry');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OAuth2CredentialProvider connection lifecycle', () => {
  it('isConnected reflects stored state', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const provider = new OAuth2CredentialProvider(config, store);

    expect(await provider.isConnected(makeContext(kv))).toBe(false);

    await store.save('x', 'user-1', { kind: 'oauth2', accessToken: 'token' });
    expect(await provider.isConnected(makeContext(kv))).toBe(true);
  });

  it('revoke deletes the stored credential', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv);
    const provider = new OAuth2CredentialProvider(config, store);
    await store.save('x', 'user-1', { kind: 'oauth2', accessToken: 'token' });

    await provider.revoke(makeContext(kv));

    expect(await provider.isConnected(makeContext(kv))).toBe(false);
  });

  it('exposes its providerId', () => {
    const provider = new OAuth2CredentialProvider(
      config,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('x');
    expect(provider.kind).toBe('oauth2');
  });
});
