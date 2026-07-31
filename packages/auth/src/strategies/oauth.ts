import type { Env } from '@adi-mcp/shared';
import type { KvStore } from '@adi-mcp/core';
import { sha256Hex } from '../crypto.js';
import type { AuthResult, AuthStrategy } from '../types.js';

const ACCESS_TOKEN_PREFIX = 'mcp-token:';

/** Shape stored in KV under `mcp-token:<sha256(token)>` when an access token is issued. */
export interface StoredAccessToken {
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly clientId: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** Key under which an access token's grant record is stored. Exported for the issuer/tests. */
export async function accessTokenKey(token: string): Promise<string> {
  return `${ACCESS_TOKEN_PREFIX}${await sha256Hex(token)}`;
}

/**
 * Validates OAuth 2.1 access tokens this server issued, by looking up their hash in KV.
 * Tokens are stored hashed so a KV dump alone cannot be replayed against the server.
 *
 * The authorization endpoints (/authorize, /token, /register) that mint these tokens live in
 * apps/server and can be backed either by this store directly or by
 * `@cloudflare/workers-oauth-provider`; this strategy only cares about verification.
 */
export class OAuthAuthStrategy implements AuthStrategy {
  readonly name = 'oauth2';

  constructor(
    private readonly kv: KvStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async authenticate(request: Request, _env: Env): Promise<AuthResult> {
    const header = request.headers.get('authorization');
    if (!header) {
      return { ok: false, status: 401, error: 'Missing Authorization header.' };
    }

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return { ok: false, status: 401, error: 'Authorization header must use the Bearer scheme.' };
    }

    const raw = await this.kv.get(await accessTokenKey(token));
    if (raw === null) {
      return { ok: false, status: 401, error: 'Access token is invalid or has been revoked.' };
    }

    const grant = JSON.parse(raw) as StoredAccessToken;
    if (grant.expiresAt <= this.now()) {
      return { ok: false, status: 401, error: 'Access token has expired.' };
    }

    return {
      ok: true,
      principal: {
        userId: grant.userId,
        scopes: grant.scopes,
        claims: { clientId: grant.clientId },
      },
    };
  }

  challenge(request: Request, _env: Env): string {
    const resourceMetadata = new URL(
      '/.well-known/oauth-protected-resource',
      request.url,
    ).toString();
    return `Bearer realm="adi-mcp", resource_metadata="${resourceMetadata}"`;
  }
}
