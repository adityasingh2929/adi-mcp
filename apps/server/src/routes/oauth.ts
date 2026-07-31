import { Hono, type Context } from 'hono';
import { MCP_ENDPOINT_PATH, OAUTH_ENDPOINT_PATHS, type Env } from '@adi-mcp/shared';
import {
  AuthorizationServer,
  OAuthError,
  SUPPORTED_CODE_CHALLENGE_METHODS,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  SUPPORTED_SCOPES,
  timingSafeEqual,
} from '@adi-mcp/auth';
import type { AppBindings } from '../context.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}

/**
 * RFC 8414 authorization server metadata. `issuer` must be exactly the origin the document
 * was fetched from, minus the well-known suffix, or clients reject the document outright.
 */
export function buildAuthorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.authorize}`,
    token_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.token}`,
    registration_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.register}`,
    revocation_endpoint: `${origin}${OAUTH_ENDPOINT_PATHS.revoke}`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: [...SUPPORTED_RESPONSE_TYPES],
    response_modes_supported: ['query'],
    grant_types_supported: [...SUPPORTED_GRANT_TYPES],
    // Public clients only: the desktop app holds no secret, PKCE binds the code instead.
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: [...SUPPORTED_CODE_CHALLENGE_METHODS],
    // RFC 8707 — clients bind a token to this MCP endpoint via the `resource` parameter.
    resource_indicators_supported: true,
  };
}

/** The consent screen. No scripts and no external assets, so the strict CSP still applies. */
function consentPage(params: {
  clientName: string;
  scopes: readonly string[];
  hidden: Record<string, string>;
  error?: string;
}): string {
  const hiddenInputs = Object.entries(params.hidden)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');

  const error = params.error
    ? `<p role="alert"><strong>${escapeHtml(params.error)}</strong></p>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize access to adi-mcp</title></head><body>
<h1>Authorize access</h1>
<p><strong>${escapeHtml(params.clientName)}</strong> is asking to connect to your adi-mcp server.</p>
<p>It will be able to use every tool you have connected, with the scope <code>${escapeHtml(params.scopes.join(' '))}</code>.</p>
${error}
<form method="post" action="${OAUTH_ENDPOINT_PATHS.authorize}">
${hiddenInputs}
<p><label for="passphrase">Server access token</label><br>
<input type="password" id="passphrase" name="passphrase" autocomplete="current-password" required></p>
<p>Paste the <code>MCP_BEARER_TOKEN</code> secret for this deployment to prove you own it.</p>
<button type="submit" name="approve" value="yes">Approve</button>
<button type="submit" name="approve" value="no">Deny</button>
</form>
</body></html>`;
}

function errorPage(title: string, detail: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body></html>`;
}

/** RFC 6749 §5.2 error body. */
function oauthErrorResponse(c: Context<AppBindings>, error: OAuthError) {
  return c.json(
    { error: error.code, error_description: error.description },
    error.status as 400 | 401,
  );
}

function toOAuthError(error: unknown): OAuthError {
  return error instanceof OAuthError
    ? error
    : new OAuthError(
        'server_error',
        'The authorization server encountered an internal error.',
        500,
      );
}

/**
 * The scopes/params carried through the consent form so the POST can rebuild the request
 * without server-side session state — a Workers isolate is not guaranteed to survive between
 * the GET and the POST.
 */
const CARRIED_PARAMS = [
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'scope',
  'resource',
] as const;

/**
 * This server's own OAuth 2.1 authorization server (RFC 8414 metadata, RFC 7591 dynamic
 * client registration, authorization-code + PKCE, refresh, RFC 7009 revocation).
 *
 * These routes only make sense when `AUTH_STRATEGY=oauth2`, because that is the strategy
 * that verifies the tokens minted here. Under the default bearer strategy they stay 404 so
 * a client cannot obtain a token that /mcp would then reject.
 */
export function createOAuthRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  function isEnabled(env: Env): boolean {
    return env.AUTH_STRATEGY === 'oauth2';
  }

  function server(c: Context<AppBindings>): AuthorizationServer {
    return new AuthorizationServer(c.get('kv'));
  }

  /**
   * The MCP client's `resource` (RFC 8707) must name this server, otherwise a token minted
   * here could be replayed against a different resource server.
   */
  function assertResourceMatches(resource: string | undefined, origin: string): void {
    if (!resource) return;
    let parsed: URL;
    try {
      parsed = new URL(resource);
    } catch {
      throw new OAuthError('invalid_target', 'resource must be an absolute URI.');
    }
    if (parsed.origin !== origin) {
      throw new OAuthError('invalid_target', `This server does not issue tokens for ${resource}.`);
    }
  }

  routes.get(OAUTH_ENDPOINT_PATHS.authorize, async (c) => {
    if (!isEnabled(c.env)) return c.notFound();

    const origin = new URL(c.req.url).origin;
    const query = c.req.query();
    const as = server(c);

    // Until the client and redirect URI check out there is nowhere safe to redirect errors.
    let client;
    let redirectUri: string;
    try {
      const resolved = await as.resolveClientForRedirect(query.client_id, query.redirect_uri);
      client = resolved.client;
      redirectUri = resolved.redirectUri;
    } catch (error) {
      const oauthError = toOAuthError(error);
      return c.html(errorPage('Authorization failed', oauthError.description), 400);
    }

    try {
      if (query.response_type !== 'code') {
        throw new OAuthError('unsupported_response_type', 'response_type must be "code".');
      }
      if (!query.code_challenge) {
        throw new OAuthError('invalid_request', 'code_challenge is required (PKCE).');
      }
      if ((query.code_challenge_method ?? 'plain') !== 'S256') {
        throw new OAuthError('invalid_request', 'code_challenge_method must be "S256".');
      }
      assertResourceMatches(query.resource, origin);

      const scopes = as.resolveScopes(query.scope);

      return c.html(
        consentPage({
          clientName: client.clientName ?? 'An MCP client',
          scopes,
          hidden: Object.fromEntries(
            CARRIED_PARAMS.filter((key) => query[key] !== undefined).map((key) => [
              key,
              key === 'redirect_uri' ? redirectUri : (query[key] as string),
            ]),
          ),
        }),
      );
    } catch (error) {
      const oauthError = toOAuthError(error);
      const target = new URL(redirectUri);
      target.searchParams.set('error', oauthError.code);
      target.searchParams.set('error_description', oauthError.description);
      if (query.state) target.searchParams.set('state', query.state);
      return c.redirect(target.toString(), 302);
    }
  });

  routes.post(OAUTH_ENDPOINT_PATHS.authorize, async (c) => {
    if (!isEnabled(c.env)) return c.notFound();

    const origin = new URL(c.req.url).origin;
    const form = await c.req.parseBody();
    const field = (name: string): string | undefined => {
      const value = form[name];
      return typeof value === 'string' ? value : undefined;
    };

    const as = server(c);
    let client;
    let redirectUri: string;
    try {
      const resolved = await as.resolveClientForRedirect(field('client_id'), field('redirect_uri'));
      client = resolved.client;
      redirectUri = resolved.redirectUri;
    } catch (error) {
      return c.html(errorPage('Authorization failed', toOAuthError(error).description), 400);
    }

    const state = field('state');
    const redirectBack = (params: Record<string, string>) => {
      const target = new URL(redirectUri);
      for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
      if (state) target.searchParams.set('state', state);
      return c.redirect(target.toString(), 302);
    };

    try {
      const codeChallenge = field('code_challenge');
      if (!codeChallenge) {
        throw new OAuthError('invalid_request', 'code_challenge is required (PKCE).');
      }
      assertResourceMatches(field('resource'), origin);
      const scopes = as.resolveScopes(field('scope'));

      if (field('approve') !== 'yes') {
        return redirectBack({
          error: 'access_denied',
          error_description: 'The user denied the request.',
        });
      }

      // Proof of ownership. Without a configured secret there is nothing to check against,
      // and auto-approving would hand every caller full access to the connected accounts.
      const expected = c.env.MCP_BEARER_TOKEN;
      if (!expected) {
        c.get('logger').error('Authorization attempted with no MCP_BEARER_TOKEN configured');
        return c.html(
          errorPage(
            'Server misconfigured',
            'MCP_BEARER_TOKEN is not set, so ownership of this server cannot be verified.',
          ),
          500,
        );
      }

      const passphrase = field('passphrase') ?? '';
      if (!timingSafeEqual(passphrase, expected)) {
        c.get('logger').warn('Rejected consent with an incorrect passphrase', {
          clientId: client.clientId,
        });
        return c.html(
          consentPage({
            clientName: client.clientName ?? 'An MCP client',
            scopes,
            hidden: Object.fromEntries(
              CARRIED_PARAMS.filter((key) => field(key) !== undefined).map((key) => [
                key,
                key === 'redirect_uri' ? redirectUri : (field(key) as string),
              ]),
            ),
            error: 'That access token did not match. Try again.',
          }),
          401,
        );
      }

      const resource = field('resource');
      const code = await as.issueAuthorizationCode({
        clientId: client.clientId,
        redirectUri,
        codeChallenge,
        scopes,
        // Single-tenant: the operator proved ownership, so the grant is the server's own user.
        userId: 'default',
        ...(resource ? { resource } : {}),
      });

      c.get('logger').info('Issued authorization code', { clientId: client.clientId });
      return redirectBack({ code });
    } catch (error) {
      const oauthError = toOAuthError(error);
      return redirectBack({
        error: oauthError.code,
        error_description: oauthError.description,
      });
    }
  });

  routes.post(OAUTH_ENDPOINT_PATHS.token, async (c) => {
    if (!isEnabled(c.env)) return c.notFound();

    const form = await c.req.parseBody();
    const field = (name: string): string | undefined => {
      const value = form[name];
      return typeof value === 'string' ? value : undefined;
    };

    try {
      const as = server(c);
      const grantType = field('grant_type');

      let grant;
      if (grantType === 'authorization_code') {
        const code = field('code');
        if (!code) throw new OAuthError('invalid_request', 'code is required.');
        grant = await as.exchangeAuthorizationCode({
          code,
          clientId: field('client_id'),
          redirectUri: field('redirect_uri'),
          codeVerifier: field('code_verifier'),
        });
      } else if (grantType === 'refresh_token') {
        const refreshToken = field('refresh_token');
        if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required.');
        grant = await as.exchangeRefreshToken({
          refreshToken,
          clientId: field('client_id'),
        });
      } else {
        throw new OAuthError(
          'unsupported_grant_type',
          `grant_type must be one of: ${SUPPORTED_GRANT_TYPES.join(', ')}.`,
        );
      }

      c.get('logger').info('Issued access token', { grantType });
      return c.json({
        access_token: grant.accessToken,
        token_type: grant.tokenType,
        expires_in: grant.expiresIn,
        refresh_token: grant.refreshToken,
        scope: grant.scope,
      });
    } catch (error) {
      const oauthError = toOAuthError(error);
      c.get('logger').warn('Token request failed', { error: oauthError.code });
      return oauthErrorResponse(c, oauthError);
    }
  });

  routes.post(OAUTH_ENDPOINT_PATHS.register, async (c) => {
    if (!isEnabled(c.env)) return c.notFound();

    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return oauthErrorResponse(
        c,
        new OAuthError('invalid_client_metadata', 'Request body must be JSON.'),
      );
    }

    try {
      const client = await server(c).registerClient(body);
      c.get('logger').info('Registered OAuth client', {
        clientId: client.clientId,
        clientName: client.clientName,
      });

      return c.json(
        {
          client_id: client.clientId,
          client_id_issued_at: client.clientIdIssuedAt,
          ...(client.clientName ? { client_name: client.clientName } : {}),
          redirect_uris: client.redirectUris,
          grant_types: client.grantTypes,
          response_types: client.responseTypes,
          token_endpoint_auth_method: client.tokenEndpointAuthMethod,
          scope: client.scope,
        },
        201,
      );
    } catch (error) {
      const oauthError = toOAuthError(error);
      c.get('logger').warn('Client registration failed', {
        error: oauthError.code,
        description: oauthError.description,
      });
      return oauthErrorResponse(c, oauthError);
    }
  });

  routes.post(OAUTH_ENDPOINT_PATHS.revoke, async (c) => {
    if (!isEnabled(c.env)) return c.notFound();

    const form = await c.req.parseBody();
    const token = form.token;
    // RFC 7009 §2.2: revoking an invalid or unknown token is still a success.
    if (typeof token === 'string' && token.length > 0) {
      await server(c).revokeToken(token);
    }
    return c.body(null, 200);
  });

  return routes;
}

/**
 * Registers the RFC 8414 metadata document. MCP clients probe the bare well-known path and,
 * when the resource lives under a path, the path-suffixed variant (RFC 8414 §3.1), so both
 * are served.
 */
export function mountAuthorizationServerMetadata(app: Hono<AppBindings>): void {
  const handler = (c: Context<AppBindings>) => {
    if (c.env.AUTH_STRATEGY !== 'oauth2') return c.notFound();
    return c.json(buildAuthorizationServerMetadata(new URL(c.req.url).origin));
  };

  app.get(OAUTH_ENDPOINT_PATHS.authorizationServerMetadata, handler);
  app.get(`${OAUTH_ENDPOINT_PATHS.authorizationServerMetadata}${MCP_ENDPOINT_PATH}`, handler);
}
