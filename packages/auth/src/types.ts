import type { Env } from '@adi-mcp/shared';
import type { KvStore, Logger } from '@adi-mcp/core';

/**
 * Identity of the caller that authenticated against the MCP endpoint itself. This is the
 * *server-level* principal (e.g. the Claude.ai client connecting to this Worker), distinct
 * from the *provider-level* credentials each integration stores for third-party APIs.
 */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly scopes: readonly string[];
  /** Free-form strategy-specific claims, e.g. an OAuth token's `props`. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

export type AuthResult =
  | { readonly ok: true; readonly principal: AuthenticatedPrincipal }
  | { readonly ok: false; readonly status: 401 | 403; readonly error: string };

/** Pluggable server-level authentication. Selected at boot from `Env.AUTH_STRATEGY`. */
export interface AuthStrategy {
  readonly name: string;
  authenticate(request: Request, env: Env): Promise<AuthResult>;
  /**
   * Value for the `WWW-Authenticate` header on a 401, so MCP clients can discover how to
   * authenticate (per RFC 9728 / the MCP authorization spec).
   */
  challenge(request: Request, env: Env): string;
}

/** A resolved third-party credential ready to be attached to an outbound API request. */
export interface ProviderCredential {
  readonly kind: 'oauth2' | 'api-key' | 'bearer';
  readonly accessToken: string;
  /** Epoch milliseconds. Absent for credentials that never expire (API keys). */
  readonly expiresAt?: number;
  readonly refreshToken?: string;
  readonly scopes?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CredentialContext {
  readonly userId: string;
  readonly env: Env;
  readonly kv: KvStore;
  readonly logger: Logger;
}

/**
 * Supplies the credential a provider's API client needs. Each provider owns its own
 * implementation, so credentials never leak across integrations.
 */
export interface CredentialProvider {
  readonly providerId: string;
  readonly kind: ProviderCredential['kind'];
  /** Resolves a usable credential, refreshing it if expired. Throws AuthRequiredError if unconnected. */
  getCredential(ctx: CredentialContext): Promise<ProviderCredential>;
  /** True when a credential exists (used by /providers status endpoints and health checks). */
  isConnected(ctx: CredentialContext): Promise<boolean>;
}
