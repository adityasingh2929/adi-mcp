import { Hono, type Context } from 'hono';
import { CredentialStore, type OAuth2CredentialProvider } from '@adi-mcp/auth';
import type { CredentialContext } from '@adi-mcp/auth';
import type { ProviderRegistry } from '@adi-mcp/core';
import type { AppBindings } from '../context.js';
import { getOAuthProviderFactory } from '../providers.js';

/** Minimal HTML shell for the OAuth callback landing pages. Escaped, no scripts, no styling deps. */
function resultPage(title: string, detail: string): string {
  const escape = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char] ?? char;
    });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>${escape(title)}</h1><p>${escape(detail)}</p><p>You can close this window and return to your MCP client.</p></body></html>`;
}

/**
 * Per-provider OAuth 2.0 connect/callback/disconnect routes. Every OAuth-based provider gets
 * these for free — the provider only supplies its {@link OAuth2Config}; no provider
 * reimplements the redirect dance.
 */
export function createProviderRoutes(registry: ProviderRegistry): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  function credentialContext(c: Context<AppBindings>): CredentialContext {
    return {
      userId: c.get('principal')?.userId ?? 'default',
      env: c.env,
      kv: c.get('kv'),
      logger: c.get('logger'),
    };
  }

  function resolveOAuthProvider(
    c: Context<AppBindings>,
    providerId: string,
  ): OAuth2CredentialProvider | null {
    const factory = getOAuthProviderFactory(providerId);
    if (!factory) return null;

    const store = new CredentialStore(c.get('kv'), c.env.CREDENTIAL_ENCRYPTION_KEY);
    return factory(c.env, store);
  }

  routes.get('/', (c) =>
    c.json({
      providers: registry.getProviders().map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        credentialKind: provider.credential.kind,
        toolCount: provider.tools.length,
        connectUrl:
          provider.credential.kind === 'oauth2' ? `/providers/${provider.id}/connect` : null,
      })),
    }),
  );

  routes.get('/:providerId/connect', async (c) => {
    const providerId = c.req.param('providerId');
    const oauth = resolveOAuthProvider(c, providerId);

    if (!oauth) {
      return c.json({ error: `Provider "${providerId}" does not use OAuth 2.0.` }, 404);
    }

    try {
      return c.redirect(await oauth.buildAuthorizationUrl(credentialContext(c)), 302);
    } catch (error) {
      c.get('logger').error('Failed to build authorization URL', {
        provider: providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json(
        { error: `Provider "${providerId}" is not configured. Set its client id and secret.` },
        500,
      );
    }
  });

  routes.get('/:providerId/callback', async (c) => {
    const providerId = c.req.param('providerId');
    const logger = c.get('logger');

    const oauthError = c.req.query('error');
    if (oauthError) {
      logger.warn('OAuth provider returned an error', { provider: providerId, error: oauthError });
      return c.html(
        resultPage(
          'Authorization failed',
          `${providerId} returned: ${c.req.query('error_description') ?? oauthError}`,
        ),
        400,
      );
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) {
      return c.html(resultPage('Authorization failed', 'Missing code or state parameter.'), 400);
    }

    const oauth = resolveOAuthProvider(c, providerId);
    if (!oauth) {
      return c.html(
        resultPage('Unknown provider', `No OAuth provider named "${providerId}".`),
        404,
      );
    }

    try {
      await oauth.handleCallback(code, state, credentialContext(c));
      return c.html(resultPage('Connected', `${providerId} is now connected.`));
    } catch (error) {
      logger.error('OAuth callback failed', {
        provider: providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.html(
        resultPage(
          'Authorization failed',
          error instanceof Error ? error.message : 'Token exchange failed.',
        ),
        400,
      );
    }
  });

  routes.get('/:providerId/status', async (c) => {
    const providerId = c.req.param('providerId');
    const provider = registry.getProvider(providerId);
    if (!provider) return c.json({ error: `Unknown provider "${providerId}".` }, 404);

    const store = new CredentialStore(c.get('kv'), c.env.CREDENTIAL_ENCRYPTION_KEY);
    const ctx = credentialContext(c);
    const connected =
      provider.credential.kind === 'none' || (await store.load(providerId, ctx.userId)) !== null;

    return c.json({ id: providerId, credentialKind: provider.credential.kind, connected });
  });

  routes.post('/:providerId/disconnect', async (c) => {
    const providerId = c.req.param('providerId');
    if (!registry.getProvider(providerId)) {
      return c.json({ error: `Unknown provider "${providerId}".` }, 404);
    }

    const store = new CredentialStore(c.get('kv'), c.env.CREDENTIAL_ENCRYPTION_KEY);
    await store.delete(providerId, credentialContext(c).userId);
    c.get('logger').info('Provider disconnected', { provider: providerId });

    return c.json({ id: providerId, connected: false });
  });

  return routes;
}
