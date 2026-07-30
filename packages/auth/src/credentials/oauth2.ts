import { KV_KEY_PREFIXES } from '@adi-mcp/shared';
import { AuthRequiredError, UpstreamApiError } from '@adi-mcp/core';
import type { CredentialStore } from '../credential-store.js';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from '../crypto.js';
import type { CredentialContext, CredentialProvider, ProviderCredential } from '../types.js';

/** Static description of a provider's OAuth 2.0 endpoints and app registration. */
export interface OAuth2Config {
  readonly providerId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  /** PKCE is required by OAuth 2.1 and by X; a few older providers still don't accept it. */
  readonly usePkce: boolean;
  /**
   * How the client authenticates at the token endpoint. X requires HTTP Basic for
   * confidential clients; most others accept credentials in the POST body.
   */
  readonly tokenAuthMethod: 'basic' | 'body' | 'none';
  /** Extra params appended to the authorization URL (e.g. Google's `access_type=offline`). */
  readonly extraAuthorizationParams?: Readonly<Record<string, string>>;
}

interface PendingAuthorization {
  readonly userId: string;
  readonly codeVerifier?: string;
  readonly createdAt: number;
}

interface TokenResponse {
  readonly access_token: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
}

/** Seconds a pending authorization (the `state` -> verifier mapping) stays valid. */
const AUTHORIZATION_TTL_SECONDS = 600;

/** Refresh a token this many ms before it actually expires, to absorb clock skew. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Generic OAuth 2.0 Authorization Code (+ optional PKCE) client with automatic refresh.
 * Every OAuth-based provider composes one of these with its own {@link OAuth2Config};
 * no provider reimplements the flow.
 */
export class OAuth2CredentialProvider implements CredentialProvider {
  readonly kind = 'oauth2' as const;

  constructor(
    private readonly config: OAuth2Config,
    private readonly store: CredentialStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get providerId(): string {
    return this.config.providerId;
  }

  /**
   * Step 1 of the flow: builds the provider's consent URL and stashes the PKCE verifier
   * against a random `state` so the callback can complete the exchange.
   */
  async buildAuthorizationUrl(ctx: CredentialContext): Promise<string> {
    const state = generateState();
    const pending: PendingAuthorization = {
      userId: ctx.userId,
      createdAt: this.now(),
      ...(this.config.usePkce ? { codeVerifier: generateCodeVerifier() } : {}),
    };

    await ctx.kv.put(this.stateKey(state), JSON.stringify(pending), {
      expirationTtl: AUTHORIZATION_TTL_SECONDS,
    });

    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    if (this.config.scopes.length > 0) {
      url.searchParams.set('scope', this.config.scopes.join(' '));
    }
    if (pending.codeVerifier) {
      url.searchParams.set('code_challenge', await deriveCodeChallenge(pending.codeVerifier));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    for (const [key, value] of Object.entries(this.config.extraAuthorizationParams ?? {})) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  /**
   * Step 2: exchanges the authorization code for tokens and persists them. Rejects an
   * unknown/expired `state`, which is what makes this flow CSRF-resistant.
   */
  async handleCallback(
    code: string,
    state: string,
    ctx: CredentialContext,
  ): Promise<ProviderCredential> {
    const raw = await ctx.kv.get(this.stateKey(state));
    if (raw === null) {
      throw new UpstreamApiError(
        this.providerId,
        400,
        'Unknown or expired OAuth state. Restart the connect flow.',
      );
    }
    await ctx.kv.delete(this.stateKey(state));

    const pending = JSON.parse(raw) as PendingAuthorization;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
    if (pending.codeVerifier) body.set('code_verifier', pending.codeVerifier);

    const token = await this.requestToken(body);
    const credential = this.toCredential(token);
    await this.store.save(this.providerId, pending.userId, credential);
    ctx.logger.info('OAuth credential stored', {
      provider: this.providerId,
      userId: pending.userId,
    });
    return credential;
  }

  async getCredential(ctx: CredentialContext): Promise<ProviderCredential> {
    const stored = await this.store.load(this.providerId, ctx.userId);
    if (!stored) {
      throw new AuthRequiredError(this.providerId);
    }

    const isExpired =
      stored.expiresAt !== undefined && stored.expiresAt - REFRESH_SKEW_MS <= this.now();
    if (!isExpired) return stored;

    if (!stored.refreshToken) {
      throw new AuthRequiredError(this.providerId);
    }

    ctx.logger.debug('Refreshing expired OAuth credential', { provider: this.providerId });
    const refreshed = await this.refresh(stored.refreshToken);
    await this.store.save(this.providerId, ctx.userId, refreshed);
    return refreshed;
  }

  async isConnected(ctx: CredentialContext): Promise<boolean> {
    return (await this.store.load(this.providerId, ctx.userId)) !== null;
  }

  /** Drops the stored credential — the "disconnect" action. */
  async revoke(ctx: CredentialContext): Promise<void> {
    await this.store.delete(this.providerId, ctx.userId);
  }

  private async refresh(refreshToken: string): Promise<ProviderCredential> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const token = await this.requestToken(body);
    // Providers that rotate refresh tokens return a new one; those that don't expect reuse.
    return this.toCredential({ ...token, refresh_token: token.refresh_token ?? refreshToken });
  }

  private async requestToken(body: URLSearchParams): Promise<TokenResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };

    if (this.config.tokenAuthMethod === 'basic' && this.config.clientSecret) {
      headers.authorization = `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`;
    } else if (this.config.tokenAuthMethod === 'body') {
      body.set('client_id', this.config.clientId);
      if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    } else {
      body.set('client_id', this.config.clientId);
    }

    const response = await this.fetchImpl(this.config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      throw new UpstreamApiError(this.providerId, response.status, await response.text());
    }

    return response.json<TokenResponse>();
  }

  private toCredential(token: TokenResponse): ProviderCredential {
    return {
      kind: 'oauth2',
      accessToken: token.access_token,
      ...(token.expires_in !== undefined
        ? { expiresAt: this.now() + token.expires_in * 1000 }
        : {}),
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(token.scope ? { scopes: token.scope.split(' ') } : {}),
    };
  }

  private stateKey(state: string): string {
    return `${KV_KEY_PREFIXES.oauthState}:${this.providerId}:${state}`;
  }
}
