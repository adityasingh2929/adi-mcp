import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const CALENDAR_PROVIDER_ID = 'calendar';
export const CALENDAR_API_BASE_URL = 'https://www.googleapis.com/calendar/v3';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'] as const;

export function buildCalendarOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: CALENDAR_PROVIDER_ID,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID ?? env.GOOGLE_CLIENT_ID ?? '',
    ...((env.GOOGLE_CALENDAR_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET)
      ? { clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET }
      : {}),
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI ?? '',
    scopes: CALENDAR_SCOPES,
    usePkce: true,
    tokenAuthMethod: 'body',
    extraAuthorizationParams: { access_type: 'offline', prompt: 'consent' },
  };
}

export function createCalendarCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildCalendarOAuthConfig(env), store);
}
