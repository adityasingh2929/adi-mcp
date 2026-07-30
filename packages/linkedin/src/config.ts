import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const LINKEDIN_PROVIDER_ID = 'linkedin';
export const LINKEDIN_API_BASE_URL = 'https://api.linkedin.com';

/**
 * LinkedIn's "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" scopes.
 * `openid`/`profile` back the userinfo lookup; `w_member_social` authorizes posting.
 */
export const LINKEDIN_SCOPES = ['openid', 'profile', 'email', 'w_member_social'] as const;

/** LinkedIn requires this header on every versioned REST call; it must be a valid YYYYMM. */
export const LINKEDIN_API_VERSION = '202506';

export function buildLinkedInOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: LINKEDIN_PROVIDER_ID,
    authorizationEndpoint: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientId: env.LINKEDIN_CLIENT_ID ?? '',
    ...(env.LINKEDIN_CLIENT_SECRET ? { clientSecret: env.LINKEDIN_CLIENT_SECRET } : {}),
    redirectUri: env.LINKEDIN_REDIRECT_URI ?? '',
    scopes: LINKEDIN_SCOPES,
    // LinkedIn's token endpoint does not accept PKCE and expects the client credentials in
    // the POST body rather than an Authorization header.
    usePkce: false,
    tokenAuthMethod: 'body',
  };
}

export function createLinkedInCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildLinkedInOAuthConfig(env), store);
}
