import { KV_KEY_PREFIXES } from '@adi-mcp/shared';
import type { KvStore } from '@adi-mcp/core';
import { deriveCodeChallenge, generateToken, sha256Hex, timingSafeEqual } from './crypto.js';
import { accessTokenKey, type StoredAccessToken } from './strategies/oauth.js';

/**
 * An OAuth 2.0 protocol error. The route layer renders it as an RFC 6749 §5.2 JSON body or,
 * at the authorization endpoint, as a redirect carrying `error`/`error_description`.
 */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status: number = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

/** The single scope this server understands: full access to every registered tool. */
export const SUPPORTED_SCOPES = ['mcp:full'] as const;
export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
export const SUPPORTED_RESPONSE_TYPES = ['code'] as const;
/** OAuth 2.1 forbids plain PKCE; S256 is the only method offered or accepted. */
export const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'] as const;

/** Short — the code is redeemed by the client immediately after the redirect. */
const AUTHORIZATION_CODE_TTL_SECONDS = 120;
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Schemes that must never be accepted as a redirect target. */
const FORBIDDEN_REDIRECT_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'about:',
]);

/** A client registered through the dynamic registration endpoint (RFC 7591). */
export interface RegisteredClient {
  readonly clientId: string;
  readonly clientName?: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
  readonly responseTypes: readonly string[];
  readonly tokenEndpointAuthMethod: 'none';
  readonly scope: string;
  /** Epoch seconds, per RFC 7591's `client_id_issued_at`. */
  readonly clientIdIssuedAt: number;
}

interface AuthorizationCodeRecord {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scopes: readonly string[];
  readonly userId: string;
  readonly resource?: string;
  readonly expiresAt: number;
}

interface RefreshTokenRecord {
  readonly clientId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
}

/** What the token endpoint hands back, before it is serialised into snake_case JSON. */
export interface TokenGrant {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly scope: string;
}

export interface AuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scopes: readonly string[];
  readonly userId: string;
  readonly resource?: string;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    throw new OAuthError('invalid_client_metadata', 'Expected an array of strings.');
  }
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Redirect URIs are the primary attack surface of an authorization server: a permissive
 * check lets an attacker register a client that redirects the victim's code to themselves.
 * Accepts https, loopback http (RFC 8252 §7.3 — native apps), and private-use schemes
 * (§7.1), and nothing that a browser would execute.
 */
function assertValidRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError('invalid_redirect_uri', `"${value}" is not an absolute URI.`);
  }

  if (url.hash) {
    throw new OAuthError('invalid_redirect_uri', 'A redirect URI must not contain a fragment.');
  }
  if (FORBIDDEN_REDIRECT_SCHEMES.has(url.protocol)) {
    throw new OAuthError('invalid_redirect_uri', `Scheme "${url.protocol}" is not allowed.`);
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'Plain http is only allowed for loopback addresses; use https.',
    );
  }
}

function clientKey(clientId: string): string {
  return `${KV_KEY_PREFIXES.oauthClient}:${clientId}`;
}

async function codeKey(code: string): Promise<string> {
  return `${KV_KEY_PREFIXES.oauthCode}:${await sha256Hex(code)}`;
}

async function refreshTokenKey(token: string): Promise<string> {
  return `${KV_KEY_PREFIXES.refreshToken}:${await sha256Hex(token)}`;
}

/**
 * This server's own OAuth 2.1 authorization server: dynamic client registration, the
 * authorization-code grant with mandatory PKCE, refresh, and revocation.
 *
 * It mints the access tokens that {@link OAuthAuthStrategy} verifies, writing them to the
 * same KV keys that strategy reads. HTTP concerns (parsing, consent UI, redirects) live in
 * the route layer; everything here is transport-agnostic so it can be unit tested directly.
 */
export class AuthorizationServer {
  constructor(
    private readonly kv: KvStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * RFC 7591 dynamic client registration. This is the step Claude Desktop performs first;
   * without it the client reports that it could not register with the sign-in service.
   *
   * Per RFC 7591 §3.2.1 the server may replace unsupported metadata rather than reject it,
   * so unusable values are narrowed to what this server supports and echoed back. The
   * client is required to honour the returned registration.
   */
  async registerClient(body: Record<string, unknown>): Promise<RegisteredClient> {
    const redirectUris = toStringArray(body.redirect_uris);
    if (!redirectUris || redirectUris.length === 0) {
      throw new OAuthError(
        'invalid_client_metadata',
        'redirect_uris is required and must be a non-empty array of strings.',
      );
    }
    for (const uri of redirectUris) assertValidRedirectUri(uri);

    const requestedGrants = toStringArray(body.grant_types) ?? [...SUPPORTED_GRANT_TYPES];
    const grantTypes = requestedGrants.filter((grant) =>
      (SUPPORTED_GRANT_TYPES as readonly string[]).includes(grant),
    );
    if (grantTypes.length === 0) {
      throw new OAuthError(
        'invalid_client_metadata',
        `No supported grant_types requested. Supported: ${SUPPORTED_GRANT_TYPES.join(', ')}.`,
      );
    }

    const requestedResponses = toStringArray(body.response_types) ?? [...SUPPORTED_RESPONSE_TYPES];
    const responseTypes = requestedResponses.filter((type) =>
      (SUPPORTED_RESPONSE_TYPES as readonly string[]).includes(type),
    );
    if (grantTypes.includes('authorization_code') && responseTypes.length === 0) {
      throw new OAuthError(
        'invalid_client_metadata',
        'The authorization_code grant requires response_type "code".',
      );
    }

    const client: RegisteredClient = {
      clientId: generateToken(),
      ...(typeof body.client_name === 'string' ? { clientName: body.client_name } : {}),
      redirectUris,
      grantTypes,
      responseTypes,
      // Public client + PKCE. No secret is issued, so there is none to leak from a desktop app.
      tokenEndpointAuthMethod: 'none',
      scope: SUPPORTED_SCOPES.join(' '),
      clientIdIssuedAt: Math.floor(this.now() / 1000),
    };

    await this.kv.put(clientKey(client.clientId), JSON.stringify(client));
    return client;
  }

  async getClient(clientId: string): Promise<RegisteredClient | null> {
    const raw = await this.kv.get(clientKey(clientId));
    return raw === null ? null : (JSON.parse(raw) as RegisteredClient);
  }

  /**
   * Loads the client and checks the redirect URI *before* anything is issued. Callers must
   * run this first: until the redirect URI is known-good there is nowhere safe to send an
   * error, and errors have to be rendered instead of redirected (RFC 6749 §4.1.2.1).
   */
  async resolveClientForRedirect(
    clientId: string | undefined,
    redirectUri: string | undefined,
  ): Promise<{ client: RegisteredClient; redirectUri: string }> {
    if (!clientId) {
      throw new OAuthError('invalid_request', 'client_id is required.');
    }
    const client = await this.getClient(clientId);
    if (!client) {
      throw new OAuthError(
        'invalid_client',
        'Unknown client_id. Register the client before authorizing.',
        401,
      );
    }

    // Omitting redirect_uri is only unambiguous when exactly one is registered.
    const resolved =
      redirectUri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!resolved) {
      throw new OAuthError('invalid_request', 'redirect_uri is required for this client.');
    }
    // Exact string match, as required by OAuth 2.1 — no prefix or wildcard matching.
    if (!client.redirectUris.includes(resolved)) {
      throw new OAuthError('invalid_request', 'redirect_uri does not match a registered value.');
    }

    return { client, redirectUri: resolved };
  }

  /** Narrows a requested `scope` string to what this server grants. */
  resolveScopes(requested: string | undefined): string[] {
    if (!requested || requested.trim() === '') return [...SUPPORTED_SCOPES];

    const granted = requested
      .split(/\s+/)
      .filter((scope) => (SUPPORTED_SCOPES as readonly string[]).includes(scope));
    if (granted.length === 0) {
      throw new OAuthError(
        'invalid_scope',
        `No supported scope requested. Supported: ${SUPPORTED_SCOPES.join(', ')}.`,
      );
    }
    return granted;
  }

  async issueAuthorizationCode(request: AuthorizationRequest): Promise<string> {
    const code = generateToken();
    const record: AuthorizationCodeRecord = {
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scopes: request.scopes,
      userId: request.userId,
      ...(request.resource ? { resource: request.resource } : {}),
      expiresAt: this.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    };

    await this.kv.put(await codeKey(code), JSON.stringify(record), {
      expirationTtl: AUTHORIZATION_CODE_TTL_SECONDS,
    });
    return code;
  }

  async exchangeAuthorizationCode(params: {
    code: string;
    clientId: string | undefined;
    redirectUri: string | undefined;
    codeVerifier: string | undefined;
  }): Promise<TokenGrant> {
    const key = await codeKey(params.code);
    const raw = await this.kv.get(key);
    if (raw === null) {
      throw new OAuthError(
        'invalid_grant',
        'Authorization code is invalid, expired, or has already been used.',
      );
    }
    // Consumed before validation: a code that fails a check here must not survive to be
    // retried, and a replay of a valid code must find nothing.
    await this.kv.delete(key);

    const record = JSON.parse(raw) as AuthorizationCodeRecord;
    if (record.expiresAt <= this.now()) {
      throw new OAuthError('invalid_grant', 'Authorization code has expired.');
    }
    if (record.clientId !== params.clientId) {
      throw new OAuthError('invalid_grant', 'Authorization code was issued to a different client.');
    }
    if (params.redirectUri !== undefined && record.redirectUri !== params.redirectUri) {
      throw new OAuthError(
        'invalid_grant',
        'redirect_uri does not match the authorization request.',
      );
    }
    if (!params.codeVerifier) {
      throw new OAuthError('invalid_grant', 'code_verifier is required (PKCE).');
    }

    const challenge = await deriveCodeChallenge(params.codeVerifier);
    if (!timingSafeEqual(challenge, record.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed.');
    }

    return this.issueTokens(record.clientId, record.userId, record.scopes);
  }

  async exchangeRefreshToken(params: {
    refreshToken: string;
    clientId: string | undefined;
  }): Promise<TokenGrant> {
    const key = await refreshTokenKey(params.refreshToken);
    const raw = await this.kv.get(key);
    if (raw === null) {
      throw new OAuthError('invalid_grant', 'Refresh token is invalid, expired, or revoked.');
    }
    // Rotated on every use, so a stolen refresh token stops working as soon as the
    // legitimate client refreshes.
    await this.kv.delete(key);

    const record = JSON.parse(raw) as RefreshTokenRecord;
    if (record.expiresAt <= this.now()) {
      throw new OAuthError('invalid_grant', 'Refresh token has expired.');
    }
    if (params.clientId !== undefined && record.clientId !== params.clientId) {
      throw new OAuthError('invalid_grant', 'Refresh token was issued to a different client.');
    }

    return this.issueTokens(record.clientId, record.userId, record.scopes);
  }

  /** RFC 7009. Accepts either token type; revoking an unknown token is a no-op success. */
  async revokeToken(token: string): Promise<void> {
    await Promise.all([
      this.kv.delete(await accessTokenKey(token)),
      this.kv.delete(await refreshTokenKey(token)),
    ]);
  }

  private async issueTokens(
    clientId: string,
    userId: string,
    scopes: readonly string[],
  ): Promise<TokenGrant> {
    const accessToken = generateToken();
    const refreshToken = generateToken();

    const grant: StoredAccessToken = {
      userId,
      scopes,
      clientId,
      expiresAt: this.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    };
    const refresh: RefreshTokenRecord = {
      clientId,
      userId,
      scopes,
      expiresAt: this.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    };

    await this.kv.put(await accessTokenKey(accessToken), JSON.stringify(grant), {
      expirationTtl: ACCESS_TOKEN_TTL_SECONDS,
    });
    await this.kv.put(await refreshTokenKey(refreshToken), JSON.stringify(refresh), {
      expirationTtl: REFRESH_TOKEN_TTL_SECONDS,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      scope: scopes.join(' '),
    };
  }
}
