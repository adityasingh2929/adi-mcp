import type { Env } from '@adi-mcp/shared';
import type { KvStore } from '@adi-mcp/core';
import { BearerTokenAuthStrategy } from './strategies/bearer.js';
import { OAuthAuthStrategy } from './strategies/oauth.js';
import type { AuthStrategy } from './types.js';

export type {
  AuthenticatedPrincipal,
  AuthResult,
  AuthStrategy,
  CredentialContext,
  CredentialProvider,
  ProviderCredential,
} from './types.js';

export { BearerTokenAuthStrategy } from './strategies/bearer.js';
export { OAuthAuthStrategy, accessTokenKey, type StoredAccessToken } from './strategies/oauth.js';

export { CredentialStore } from './credential-store.js';
export { StaticCredentialProvider } from './credentials/static.js';
export { OAuth2CredentialProvider, type OAuth2Config } from './credentials/oauth2.js';

export {
  encryptString,
  decryptString,
  timingSafeEqual,
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
} from './crypto.js';

/** Picks the server-level auth strategy from `Env.AUTH_STRATEGY`, defaulting to bearer. */
export function createAuthStrategy(env: Env, kv: KvStore): AuthStrategy {
  return env.AUTH_STRATEGY === 'oauth2' ? new OAuthAuthStrategy(kv) : new BearerTokenAuthStrategy();
}
