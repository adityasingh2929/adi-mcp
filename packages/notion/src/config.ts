import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const NOTION_PROVIDER_ID = 'notion';
export const NOTION_API_BASE_URL = 'https://api.notion.com/v1';

/** Notion pins behavior to a dated API version; every request must send this header. */
export const NOTION_API_VERSION = '2022-06-28';

export function buildNotionOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: NOTION_PROVIDER_ID,
    authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
    tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
    clientId: env.NOTION_CLIENT_ID ?? '',
    ...(env.NOTION_CLIENT_SECRET ? { clientSecret: env.NOTION_CLIENT_SECRET } : {}),
    redirectUri: env.NOTION_REDIRECT_URI ?? '',
    // Notion grants capabilities through the integration's settings rather than OAuth scopes.
    scopes: [],
    usePkce: false,
    tokenAuthMethod: 'basic',
    extraAuthorizationParams: { owner: 'user' },
  };
}

export function createNotionCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildNotionOAuthConfig(env), store);
}
