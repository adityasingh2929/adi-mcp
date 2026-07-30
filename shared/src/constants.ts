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
} as const;

export const HTTP_HEADERS = {
  requestId: 'x-request-id',
  mcpProtocolVersion: 'mcp-protocol-version',
} as const;
