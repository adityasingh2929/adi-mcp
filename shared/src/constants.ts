/** Canonical provider ids. Order here drives no runtime behavior — it's just documentation. */
export const PROVIDER_IDS = [
  'github',
  'x',
  'linkedin',
  'gmail',
  'calendar',
  'notion',
  'obsidian',
  'postgres',
  'supabase',
  'stripe',
  'resend',
  'filesystem',
  'browser',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MCP_ENDPOINT_PATH = '/mcp';
export const HEALTH_ENDPOINT_PATH = '/health';

export const KV_KEY_PREFIXES = {
  credential: 'cred',
  oauthState: 'oauth-state',
  rateLimit: 'ratelimit',
  /** Clients registered with this server's own authorization server (RFC 7591). */
  oauthClient: 'oauth-client',
  /** Authorization codes this server issued, keyed by hash. */
  oauthCode: 'oauth-code',
  /** Refresh tokens this server issued, keyed by hash. */
  refreshToken: 'mcp-refresh',
} as const;

/** Paths for this server's own OAuth 2.1 authorization server. Mirrored in its metadata document. */
export const OAUTH_ENDPOINT_PATHS = {
  authorizationServerMetadata: '/.well-known/oauth-authorization-server',
  protectedResourceMetadata: '/.well-known/oauth-protected-resource',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
  revoke: '/oauth/revoke',
} as const;

export const HTTP_HEADERS = {
  requestId: 'x-request-id',
  mcpProtocolVersion: 'mcp-protocol-version',
} as const;
