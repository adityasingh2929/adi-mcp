import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const GITHUB_PROVIDER_ID = 'github';
export const GITHUB_API_BASE_URL = 'https://api.github.com';

export const GITHUB_SCOPES = ['repo', 'read:user', 'read:org'] as const;

export function buildGithubOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: GITHUB_PROVIDER_ID,
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    clientId: env.GITHUB_CLIENT_ID ?? '',
    ...(env.GITHUB_CLIENT_SECRET ? { clientSecret: env.GITHUB_CLIENT_SECRET } : {}),
    redirectUri: env.GITHUB_REDIRECT_URI ?? '',
    scopes: GITHUB_SCOPES,
    // GitHub OAuth Apps do not support PKCE and expect credentials in the request body.
    usePkce: false,
    tokenAuthMethod: 'body',
  };
}

export function createGithubCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildGithubOAuthConfig(env), store);
}
