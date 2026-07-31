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

/**
 * LinkedIn requires this header on every versioned REST call, as a `YYYYMM` string.
 *
 * LinkedIn retires a version roughly a year after release, and a stale one fails the entire
 * call with HTTP 426 — `Requested version <YYYYMM>01 is not active`. Because that expiry is a
 * wall-clock event rather than anything in this codebase, the value is overridable through
 * `LINKEDIN_API_VERSION` so it can be bumped without a code change.
 */
export const DEFAULT_LINKEDIN_API_VERSION = '202606';

export function linkedInApiVersion(env: Env): string {
  return env.LINKEDIN_API_VERSION ?? DEFAULT_LINKEDIN_API_VERSION;
}

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
