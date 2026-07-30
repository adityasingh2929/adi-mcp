import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const GMAIL_PROVIDER_ID = 'gmail';
export const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export function buildGmailOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: GMAIL_PROVIDER_ID,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    ...(env.GOOGLE_CLIENT_SECRET ? { clientSecret: env.GOOGLE_CLIENT_SECRET } : {}),
    redirectUri: env.GOOGLE_REDIRECT_URI ?? '',
    scopes: GMAIL_SCOPES,
    usePkce: true,
    tokenAuthMethod: 'body',
    // Google only issues a refresh token when both are set, and only on first consent —
    // `prompt=consent` forces re-issue so a reconnect doesn't silently lose offline access.
    extraAuthorizationParams: { access_type: 'offline', prompt: 'consent' },
  };
}

export function createGmailCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildGmailOAuthConfig(env), store);
}
