import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const X_PROVIDER_ID = 'x';
export const X_API_BASE_URL = 'https://api.x.com/2';

/**
 * Scopes requested during the OAuth consent step.
 * `offline.access` is what makes X issue a refresh token — without it the connection
 * silently dies after the ~2h access-token lifetime.
 */
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] as const;

export function buildXOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: X_PROVIDER_ID,
    authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
    tokenEndpoint: `${X_API_BASE_URL}/oauth2/token`,
    clientId: env.X_CLIENT_ID ?? '',
    ...(env.X_CLIENT_SECRET ? { clientSecret: env.X_CLIENT_SECRET } : {}),
    redirectUri: env.X_REDIRECT_URI ?? '',
    scopes: X_SCOPES,
    // X mandates PKCE, and requires HTTP Basic client auth at the token endpoint for
    // confidential clients.
    usePkce: true,
    tokenAuthMethod: 'basic',
  };
}

export function createXCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildXOAuthConfig(env), store);
}
