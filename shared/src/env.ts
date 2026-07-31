/**
 * Cloudflare Worker environment bindings + vars/secrets shared by the server
 * and every provider package. Provider-specific secret names are declared
 * here too so a new provider only ever needs to extend this one interface.
 */
export interface Env {
  // ── Bindings ──
  readonly ADI_MCP_KV: KVNamespace;

  // ── Server vars ──
  readonly LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  readonly AUTH_STRATEGY?: 'bearer' | 'oauth2';
  readonly RATE_LIMIT_MAX_REQUESTS?: string;
  readonly RATE_LIMIT_WINDOW_SECONDS?: string;
  readonly CORS_ALLOWED_ORIGINS?: string;

  // ── Server-level auth secrets ──
  readonly MCP_BEARER_TOKEN?: string;
  readonly OAUTH_COOKIE_SECRET?: string;

  // ── Credential encryption ──
  readonly CREDENTIAL_ENCRYPTION_KEY?: string;

  // ── X ──
  readonly X_CLIENT_ID?: string;
  readonly X_CLIENT_SECRET?: string;
  readonly X_REDIRECT_URI?: string;

  // ── LinkedIn ──
  readonly LINKEDIN_CLIENT_ID?: string;
  readonly LINKEDIN_CLIENT_SECRET?: string;
  readonly LINKEDIN_REDIRECT_URI?: string;
  /** `YYYYMM` override for the LinkedIn-Version header; see DEFAULT_LINKEDIN_API_VERSION. */
  readonly LINKEDIN_API_VERSION?: string;

  // ── GitHub ──
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GITHUB_REDIRECT_URI?: string;

  // ── Gmail / Google Calendar ──
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly GOOGLE_REDIRECT_URI?: string;
  readonly GOOGLE_CALENDAR_CLIENT_ID?: string;
  readonly GOOGLE_CALENDAR_CLIENT_SECRET?: string;
  readonly GOOGLE_CALENDAR_REDIRECT_URI?: string;

  // ── Notion ──
  readonly NOTION_CLIENT_ID?: string;
  readonly NOTION_CLIENT_SECRET?: string;
  readonly NOTION_REDIRECT_URI?: string;

  // ── Obsidian ──
  readonly OBSIDIAN_API_URL?: string;
  readonly OBSIDIAN_API_KEY?: string;

  // ── Postgres ──
  readonly POSTGRES_CONNECTION_STRING?: string;

  // ── Supabase ──
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;

  // ── Stripe ──
  readonly STRIPE_API_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;

  // ── Resend ──
  readonly RESEND_API_KEY?: string;

  // ── Filesystem ──
  readonly FILESYSTEM_ROOT?: string;

  // ── Browser automation ──
  readonly BROWSER_REMOTE_ENDPOINT?: string;
  readonly BROWSER_API_KEY?: string;
}
