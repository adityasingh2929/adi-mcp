import type { Env } from '@adi-mcp/shared';
import { timingSafeEqual } from '../crypto.js';
import type { AuthResult, AuthStrategy } from '../types.js';

const DEFAULT_USER_ID = 'default';

/**
 * Validates a static bearer token from the `MCP_BEARER_TOKEN` secret. This is the practical
 * default for a single-tenant deployment: one token, held by the MCP client, no OAuth dance.
 * For multi-tenant or third-party-client deployments use the OAuth strategy instead.
 */
export class BearerTokenAuthStrategy implements AuthStrategy {
  readonly name = 'bearer';

  async authenticate(request: Request, env: Env): Promise<AuthResult> {
    const expected = env.MCP_BEARER_TOKEN;
    if (!expected) {
      return {
        ok: false,
        status: 401,
        error: 'Server is misconfigured: MCP_BEARER_TOKEN is not set.',
      };
    }

    const header = request.headers.get('authorization');
    if (!header) {
      return { ok: false, status: 401, error: 'Missing Authorization header.' };
    }

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return { ok: false, status: 401, error: 'Authorization header must use the Bearer scheme.' };
    }

    if (!timingSafeEqual(token, expected)) {
      return { ok: false, status: 403, error: 'Invalid bearer token.' };
    }

    return { ok: true, principal: { userId: DEFAULT_USER_ID, scopes: ['mcp:full'] } };
  }

  challenge(request: Request, _env: Env): string {
    const resourceMetadata = new URL(
      '/.well-known/oauth-protected-resource',
      request.url,
    ).toString();
    return `Bearer realm="adi-mcp", resource_metadata="${resourceMetadata}"`;
  }
}
