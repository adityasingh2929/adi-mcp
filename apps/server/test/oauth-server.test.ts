import { describe, expect, it } from 'vitest';
import type { Env } from '@adi-mcp/shared';
import { deriveCodeChallenge, generateCodeVerifier } from '@adi-mcp/auth';
import { createApp } from '../src/app.js';
import {
  INITIALIZE_REQUEST,
  TEST_BEARER_TOKEN,
  makeEnv,
  mcpRequest,
  readJsonRpc,
} from './helpers.js';

const app = createApp();
const ORIGIN = 'https://worker.test';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

/** Response shapes, declared so property access stays typed under noUncheckedIndexedAccess. */
interface ClientRegistration {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method: string;
  redirect_uris: string[];
  error?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  error?: string;
}

function oauthEnv(overrides: Partial<Env> = {}): Env {
  return makeEnv({ AUTH_STRATEGY: 'oauth2', ...overrides });
}

function form(fields: Record<string, string>): Request {
  return new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

async function registerClient(env: Env, overrides: Record<string, unknown> = {}) {
  const response = await app.fetch(
    new Request(`${ORIGIN}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...overrides,
      }),
    }),
    env,
  );
  return { response, body: await response.json<ClientRegistration>() };
}

/**
 * Walks the whole client flow exactly as an MCP client does: discover, register, authorize,
 * consent, exchange. Returns the token response body.
 */
async function completeOAuthFlow(env: Env) {
  const { body: client } = await registerClient(env);
  const verifier = generateCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);

  const authorizeUrl = new URL(`${ORIGIN}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', 'client-state-123');
  authorizeUrl.searchParams.set('scope', 'mcp:full');
  authorizeUrl.searchParams.set('resource', `${ORIGIN}/mcp`);

  const consent = await app.fetch(new Request(authorizeUrl.toString()), env);

  const approval = await app.fetch(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        state: 'client-state-123',
        scope: 'mcp:full',
        resource: `${ORIGIN}/mcp`,
        passphrase: TEST_BEARER_TOKEN,
        approve: 'yes',
      }).toString(),
    }),
    env,
  );

  const location = new URL(approval.headers.get('location') ?? '');
  const code = location.searchParams.get('code') ?? '';

  const token = await app.fetch(
    form({
      grant_type: 'authorization_code',
      code,
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
    env,
  );

  return {
    client,
    consent,
    approval,
    location,
    tokenResponse: token,
    tokens: await token.json<TokenResponse>(),
  };
}

describe('GET /.well-known/oauth-authorization-server', () => {
  it('serves RFC 8414 metadata with every field a client needs', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      oauthEnv(),
    );

    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();

    expect(body.issuer).toBe(ORIGIN);
    expect(body.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(body.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(body.scopes_supported).toEqual(['mcp:full']);
    expect(body.response_modes_supported).toEqual(['query']);
    expect(body.resource_indicators_supported).toBe(true);
  });

  it('serves the same document at the path-suffixed variant clients probe', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/mcp`),
      oauthEnv(),
    );

    expect(response.status).toBe(200);
    expect((await response.json<Record<string, unknown>>()).issuer).toBe(ORIGIN);
  });

  it('names an issuer that matches the protected resource document', async () => {
    const asResponse = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      oauthEnv(),
    );
    const prResponse = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
      oauthEnv(),
    );

    const asMetadata = await asResponse.json<Record<string, string>>();
    const prMetadata = await prResponse.json<Record<string, string[]>>();

    expect(prMetadata.authorization_servers).toContain(asMetadata.issuer);
  });

  it('stays 404 under the bearer strategy, which mints no tokens of its own', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      makeEnv({ AUTH_STRATEGY: 'bearer' }),
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /oauth/register', () => {
  it('registers a public client and returns its credentials', async () => {
    const { response, body } = await registerClient(oauthEnv());

    expect(response.status).toBe(201);
    expect(body.client_id).toBeTruthy();
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual([REDIRECT_URI]);
    expect(body.client_secret).toBeUndefined();
  });

  it('rejects a registration with no redirect_uris', async () => {
    const { response, body } = await registerClient(oauthEnv(), { redirect_uris: undefined });

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_client_metadata');
  });

  it('rejects a non-JSON body', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
      oauthEnv(),
    );

    expect(response.status).toBe(400);
  });
});

describe('GET /oauth/authorize', () => {
  it('renders a consent page for a registered client', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('code_challenge', await deriveCodeChallenge(generateCodeVerifier()));
    url.searchParams.set('code_challenge_method', 'S256');

    const response = await app.fetch(new Request(url.toString()), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Authorize access');
    expect(html).toContain('Claude');
    expect(html).toContain('name="passphrase"');
  });

  it('renders an error rather than redirecting when the client is unknown', async () => {
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'never-registered');
    url.searchParams.set('redirect_uri', REDIRECT_URI);

    const response = await app.fetch(new Request(url.toString()), oauthEnv());

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Unknown client_id');
  });

  it('refuses a redirect_uri the client did not register', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', 'https://attacker.example.com/steal');

    const response = await app.fetch(new Request(url.toString()), env);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects a PKCE-less request back with an error', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('state', 'abc');

    const response = await app.fetch(new Request(url.toString()), env);
    const location = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(302);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('abc');
  });

  it('rejects a resource indicator naming a different server', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);
    const url = new URL(`${ORIGIN}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('code_challenge', await deriveCodeChallenge(generateCodeVerifier()));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', 'https://someone-else.example.com/mcp');

    const response = await app.fetch(new Request(url.toString()), env);
    const location = new URL(response.headers.get('location') ?? '');

    expect(location.searchParams.get('error')).toBe('invalid_target');
  });
});

describe('POST /oauth/authorize (consent)', () => {
  it('refuses to approve without the server passphrase', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);

    const response = await app.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: await deriveCodeChallenge(generateCodeVerifier()),
          passphrase: 'wrong-token',
          approve: 'yes',
        }).toString(),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('did not match');
  });

  it('redirects with access_denied when the user denies', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);

    const response = await app.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: await deriveCodeChallenge(generateCodeVerifier()),
          state: 'xyz',
          approve: 'no',
        }).toString(),
      }),
      env,
    );

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
  });

  it('fails closed when MCP_BEARER_TOKEN is not configured', async () => {
    const env = oauthEnv({ MCP_BEARER_TOKEN: undefined });
    const { body: client } = await registerClient(env);

    const response = await app.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: await deriveCodeChallenge(generateCodeVerifier()),
          passphrase: '',
          approve: 'yes',
        }).toString(),
      }),
      env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('the full authorization code flow', () => {
  it('carries a client from registration to an authenticated MCP call', async () => {
    const env = oauthEnv();
    const { consent, approval, location, tokenResponse, tokens } = await completeOAuthFlow(env);

    expect(consent.status).toBe(200);

    // The redirect back to the client carries the code and echoes state untouched.
    expect(approval.status).toBe(302);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('client-state-123');
    expect(location.searchParams.get('code')).toBeTruthy();

    expect(tokenResponse.status).toBe(200);
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope).toBe('mcp:full');

    // The whole point: the issued token opens the MCP endpoint.
    const mcp = await app.fetch(mcpRequest(INITIALIZE_REQUEST, tokens.access_token), env);
    expect(mcp.status).toBe(200);
    const rpc = await readJsonRpc(mcp);
    expect((rpc.result as Record<string, unknown>).protocolVersion).toBeTruthy();
  });

  it('leaves the MCP endpoint closed to a token this server never issued', async () => {
    const env = oauthEnv();
    const response = await app.fetch(mcpRequest(INITIALIZE_REQUEST, 'made-up-token'), env);

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it('refreshes the access token', async () => {
    const env = oauthEnv();
    const { client, tokens } = await completeOAuthFlow(env);

    const response = await app.fetch(
      form({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      }),
      env,
    );
    const refreshed = await response.json<TokenResponse>();

    expect(response.status).toBe(200);
    expect(refreshed.access_token).toBeTruthy();

    const mcp = await app.fetch(mcpRequest(INITIALIZE_REQUEST, refreshed.access_token), env);
    expect(mcp.status).toBe(200);
  });

  it('revokes an access token', async () => {
    const env = oauthEnv();
    const { tokens } = await completeOAuthFlow(env);

    const revoke = await app.fetch(
      new Request(`${ORIGIN}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.access_token }).toString(),
      }),
      env,
    );
    expect(revoke.status).toBe(200);

    const mcp = await app.fetch(mcpRequest(INITIALIZE_REQUEST, tokens.access_token), env);
    expect(mcp.status).toBe(401);
  });

  it('rejects a token request with the wrong PKCE verifier', async () => {
    const env = oauthEnv();
    const { body: client } = await registerClient(env);
    const challenge = await deriveCodeChallenge(generateCodeVerifier());

    const approval = await app.fetch(
      new Request(`${ORIGIN}/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          passphrase: TEST_BEARER_TOKEN,
          approve: 'yes',
        }).toString(),
      }),
      env,
    );
    const code = new URL(approval.headers.get('location') ?? '').searchParams.get('code') ?? '';

    const response = await app.fetch(
      form({
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: generateCodeVerifier(),
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toBe('invalid_grant');
  });

  it('rejects an unsupported grant type', async () => {
    const response = await app.fetch(form({ grant_type: 'client_credentials' }), oauthEnv());

    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toBe('unsupported_grant_type');
  });

  it('keeps the token endpoint 404 under the bearer strategy', async () => {
    const response = await app.fetch(
      form({ grant_type: 'authorization_code', code: 'x' }),
      makeEnv({ AUTH_STRATEGY: 'bearer' }),
    );

    expect(response.status).toBe(404);
  });
});
