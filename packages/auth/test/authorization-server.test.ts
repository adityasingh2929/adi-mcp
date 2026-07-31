import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '@adi-mcp/core';
import { AuthorizationServer, OAuthError } from '../src/authorization-server.js';
import { OAuthAuthStrategy } from '../src/strategies/oauth.js';
import { deriveCodeChallenge, generateCodeVerifier } from '../src/crypto.js';
import type { Env } from '@adi-mcp/shared';

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

async function registerTestClient(
  as: AuthorizationServer,
  overrides: Record<string, unknown> = {},
) {
  return as.registerClient({
    client_name: 'Claude',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  });
}

/** Drives a full code+PKCE exchange and returns the resulting grant. */
async function runFlow(as: AuthorizationServer) {
  const client = await registerTestClient(as);
  const verifier = generateCodeVerifier();
  const code = await as.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: REDIRECT_URI,
    codeChallenge: await deriveCodeChallenge(verifier),
    scopes: ['mcp:full'],
    userId: 'default',
  });

  const grant = await as.exchangeAuthorizationCode({
    code,
    clientId: client.clientId,
    redirectUri: REDIRECT_URI,
    codeVerifier: verifier,
  });

  return { client, verifier, code, grant };
}

describe('AuthorizationServer.registerClient', () => {
  it('issues a client_id for a valid public client', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);

    expect(client.clientId).toBeTruthy();
    expect(client.clientName).toBe('Claude');
    expect(client.redirectUris).toEqual([REDIRECT_URI]);
    expect(client.tokenEndpointAuthMethod).toBe('none');
    expect(client.scope).toBe('mcp:full');
    expect(client.clientIdIssuedAt).toBeGreaterThan(0);
  });

  it('persists the client so it can be looked up at authorize time', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);

    expect(await as.getClient(client.clientId)).toMatchObject({ clientId: client.clientId });
  });

  it('rejects a registration with no redirect_uris', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(as.registerClient({ client_name: 'Claude' })).rejects.toThrow(OAuthError);
  });

  it('rejects a non-loopback http redirect URI', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(
      registerTestClient(as, { redirect_uris: ['http://evil.example.com/cb'] }),
    ).rejects.toThrow(/only allowed for loopback/);
  });

  it('allows loopback http for native clients', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as, {
      redirect_uris: ['http://127.0.0.1:33418/oauth/callback'],
    });
    expect(client.redirectUris).toEqual(['http://127.0.0.1:33418/oauth/callback']);
  });

  it('allows a private-use scheme for desktop clients', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as, { redirect_uris: ['com.example.app:/callback'] });
    expect(client.redirectUris).toEqual(['com.example.app:/callback']);
  });

  it('rejects a javascript: redirect URI', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(
      registerTestClient(as, { redirect_uris: ['javascript:alert(1)'] }),
    ).rejects.toThrow(/not allowed/);
  });

  it('narrows unsupported grant types instead of failing the registration', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as, {
      grant_types: ['authorization_code', 'client_credentials'],
    });
    expect(client.grantTypes).toEqual(['authorization_code']);
  });

  it('rejects a registration with no supported grant type at all', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(registerTestClient(as, { grant_types: ['client_credentials'] })).rejects.toThrow(
      /No supported grant_types/,
    );
  });
});

describe('AuthorizationServer.resolveClientForRedirect', () => {
  it('rejects an unknown client_id', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(as.resolveClientForRedirect('nope', REDIRECT_URI)).rejects.toThrow(
      /Unknown client/,
    );
  });

  it('rejects a redirect_uri that was not registered', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);

    await expect(
      as.resolveClientForRedirect(client.clientId, 'https://attacker.example.com/cb'),
    ).rejects.toThrow(/does not match a registered value/);
  });

  it('defaults to the sole registered redirect_uri when the request omits it', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);

    const resolved = await as.resolveClientForRedirect(client.clientId, undefined);
    expect(resolved.redirectUri).toBe(REDIRECT_URI);
  });

  it('requires an explicit redirect_uri when several are registered', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as, {
      redirect_uris: [REDIRECT_URI, 'https://claude.ai/other'],
    });

    await expect(as.resolveClientForRedirect(client.clientId, undefined)).rejects.toThrow(
      /redirect_uri is required/,
    );
  });
});

describe('AuthorizationServer token exchange', () => {
  it('exchanges a code for an access token and a refresh token', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const { grant } = await runFlow(as);

    expect(grant.accessToken).toBeTruthy();
    expect(grant.refreshToken).toBeTruthy();
    expect(grant.tokenType).toBe('Bearer');
    expect(grant.expiresIn).toBe(3600);
    expect(grant.scope).toBe('mcp:full');
  });

  it('mints a token the OAuth auth strategy accepts', async () => {
    const kv = new InMemoryKvStore();
    const as = new AuthorizationServer(kv);
    const { grant } = await runFlow(as);

    const result = await new OAuthAuthStrategy(kv).authenticate(
      new Request('https://worker.test/mcp', {
        headers: { authorization: `Bearer ${grant.accessToken}` },
      }),
      {} as Env,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.principal.userId).toBe('default');
    expect(result.ok && result.principal.scopes).toEqual(['mcp:full']);
  });

  it('rejects a code replay — the code is single use', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const { client, code, verifier } = await runFlow(as);

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/already been used/);
  });

  it('rejects a wrong PKCE verifier', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);
    const code = await as.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await deriveCodeChallenge(generateCodeVerifier()),
      scopes: ['mcp:full'],
      userId: 'default',
    });

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: generateCodeVerifier(),
      }),
    ).rejects.toThrow(/PKCE verification failed/);
  });

  it('requires a code_verifier', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);
    const code = await as.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await deriveCodeChallenge(generateCodeVerifier()),
      scopes: ['mcp:full'],
      userId: 'default',
    });

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: undefined,
      }),
    ).rejects.toThrow(/code_verifier is required/);
  });

  it('rejects a code redeemed by a different client', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as);
    const other = await registerTestClient(as);
    const verifier = generateCodeVerifier();
    const code = await as.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await deriveCodeChallenge(verifier),
      scopes: ['mcp:full'],
      userId: 'default',
    });

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: other.clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/different client/);
  });

  it('rejects a code whose redirect_uri does not match the authorization request', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const client = await registerTestClient(as, {
      redirect_uris: [REDIRECT_URI, 'https://claude.ai/other'],
    });
    const verifier = generateCodeVerifier();
    const code = await as.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await deriveCodeChallenge(verifier),
      scopes: ['mcp:full'],
      userId: 'default',
    });

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: 'https://claude.ai/other',
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/redirect_uri does not match/);
  });

  it('rejects an expired authorization code', async () => {
    let now = 1_000_000;
    const as = new AuthorizationServer(new InMemoryKvStore(() => now), () => now);
    const client = await registerTestClient(as);
    const verifier = generateCodeVerifier();
    const code = await as.issueAuthorizationCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: await deriveCodeChallenge(verifier),
      scopes: ['mcp:full'],
      userId: 'default',
    });

    now += 121_000;

    await expect(
      as.exchangeAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      }),
    ).rejects.toThrow(/invalid, expired/);
  });
});

describe('AuthorizationServer refresh and revocation', () => {
  it('exchanges a refresh token for a new access token', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const { client, grant } = await runFlow(as);

    const refreshed = await as.exchangeRefreshToken({
      refreshToken: grant.refreshToken,
      clientId: client.clientId,
    });

    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.accessToken).not.toBe(grant.accessToken);
  });

  it('rotates the refresh token, invalidating the used one', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const { client, grant } = await runFlow(as);

    await as.exchangeRefreshToken({ refreshToken: grant.refreshToken, clientId: client.clientId });

    await expect(
      as.exchangeRefreshToken({ refreshToken: grant.refreshToken, clientId: client.clientId }),
    ).rejects.toThrow(/invalid, expired, or revoked/);
  });

  it('rejects a refresh token presented by a different client', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    const { grant } = await runFlow(as);
    const other = await registerTestClient(as);

    await expect(
      as.exchangeRefreshToken({ refreshToken: grant.refreshToken, clientId: other.clientId }),
    ).rejects.toThrow(/different client/);
  });

  it('revoking an access token stops it authenticating', async () => {
    const kv = new InMemoryKvStore();
    const as = new AuthorizationServer(kv);
    const { grant } = await runFlow(as);

    await as.revokeToken(grant.accessToken);

    const result = await new OAuthAuthStrategy(kv).authenticate(
      new Request('https://worker.test/mcp', {
        headers: { authorization: `Bearer ${grant.accessToken}` },
      }),
      {} as Env,
    );
    expect(result.ok).toBe(false);
  });

  it('revoking an unknown token succeeds (RFC 7009)', async () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    await expect(as.revokeToken('not-a-real-token')).resolves.toBeUndefined();
  });
});

describe('AuthorizationServer.resolveScopes', () => {
  it('defaults to the full scope when none is requested', () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    expect(as.resolveScopes(undefined)).toEqual(['mcp:full']);
  });

  it('drops unsupported scopes', () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    expect(as.resolveScopes('mcp:full admin:everything')).toEqual(['mcp:full']);
  });

  it('rejects a request for only unsupported scopes', () => {
    const as = new AuthorizationServer(new InMemoryKvStore());
    expect(() => as.resolveScopes('admin:everything')).toThrow(/No supported scope/);
  });
});
