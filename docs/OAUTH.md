# Authentication

There are two completely independent auth layers here, and conflating them is the single
most common source of confusion:

| | Question it answers | Configured by | Lives in |
| --- | --- | --- | --- |
| **Server-level** | May this client talk to `/mcp` at all? | `AUTH_STRATEGY` | `packages/auth/src/strategies/` |
| **Provider-level** | How does the `x` provider reach the X API? | Per-provider `OAuth2Config` | `packages/auth/src/credentials/` |

They share a KV namespace and nothing else. Your MCP client's bearer token has no
relationship to your X access token; revoking one does not touch the other.

---

## Server-level auth

One `AuthStrategy` guards `/mcp`, selected at boot from `Env.AUTH_STRATEGY` and defaulting to
`bearer`:

```ts
export function createAuthStrategy(env: Env, kv: KvStore): AuthStrategy {
  return env.AUTH_STRATEGY === 'oauth2' ? new OAuthAuthStrategy(kv) : new BearerTokenAuthStrategy();
}
```

Both implement the same three-method interface — `authenticate`, `challenge`, and a `name` —
so the middleware never branches on which one is active.

### `bearer` (default)

A single static token from the `MCP_BEARER_TOKEN` secret, compared with `timingSafeEqual` so a
wrong guess can't be narrowed by timing. On success the caller becomes the principal
`{ userId: 'default', scopes: ['mcp:full'] }`.

That fixed `userId` is what makes credentials single-tenant: every stored credential is keyed
`cred:<provider>:default`. One deployment, one person's accounts. For a personal server this
is the right trade — no token database, no consent screens, no session state.

```bash
openssl rand -base64 48
```

```bash
cd apps/server && pnpm exec wrangler secret put MCP_BEARER_TOKEN
```

Failure modes are distinguished on purpose: a missing or malformed `Authorization` header is
**401** (you haven't authenticated), a well-formed but wrong token is **403** (you have, and
you're not allowed).

### `oauth2`

`OAuthAuthStrategy` validates access tokens **this server issued**, by hashing the presented
token with SHA-256 and looking the digest up in KV:

```
mcp-token:<sha256hex(token)>  ->  { userId, scopes, clientId, expiresAt }
```

Tokens are stored hashed, never in plaintext, so a KV dump alone cannot be replayed against
the server. An unknown digest and an expired grant are both 401, with distinct messages.

> **Current state:** the strategy verifies tokens; the authorization endpoints that *mint*
> them (`/authorize`, `/token`, `/register`) are not implemented in `apps/server`. Setting
> `AUTH_STRATEGY=oauth2` today means every request 401s until something writes grant records
> into KV — either a hand-rolled issuer or `@cloudflare/workers-oauth-provider` mounted in
> front of the app. `accessTokenKey()` is exported precisely so an issuer can compute the same
> key. `OAUTH_COOKIE_SECRET` is reserved in `Env` for that work and is currently unused.

To mint a grant by hand (useful for testing the strategy):

```bash
cd apps/server && pnpm exec wrangler kv key put --binding ADI_MCP_KV "mcp-token:$(printf %s "$TOKEN" | sha256sum | cut -d' ' -f1)" '{"userId":"alice","scopes":["mcp:full"],"clientId":"test","expiresAt":4102444800000}'
```

Reach for this strategy when different callers must map to different `userId`s — that is what
gives each of them their own `cred:<provider>:<userId>` credential space.

### Discovery

The server implements the discovery half of the MCP authorization spec regardless of strategy.
Every 401 carries a challenge:

```
WWW-Authenticate: Bearer realm="adi-mcp", resource_metadata="https://<host>/.well-known/oauth-protected-resource"
```

And that endpoint (RFC 9728) is public:

```json
{
  "resource": "https://<host>/mcp",
  "authorization_servers": ["https://<host>"],
  "scopes_supported": ["mcp:full"],
  "bearer_methods_supported": ["header"]
}
```

A compliant client that gets a 401 can follow the header and learn how to authenticate rather
than just failing. Note that under `bearer` the advertised `authorization_servers` has nothing
to serve — the metadata is honest about the shape, not a promise that a full OAuth server is
running.

---

## Provider-level auth

Each provider declares a `CredentialRequirement` describing what it needs, and gets one
`CredentialProvider` implementation supplying it. Two implementations cover all thirteen.

### `StaticCredentialProvider`

For providers that authenticate with one long-lived key. It reads the value straight from the
Worker env — no KV, no refresh, no connect flow:

```ts
export const stripeCredentialProvider = new StaticCredentialProvider(
  STRIPE_PROVIDER_ID,
  'api-key',
  'STRIPE_API_KEY',
);
```

The env key is typed `keyof Env`, so referencing a secret that doesn't exist fails to compile.
Missing at runtime → `AuthRequiredError`, which reaches the model as a normal tool error.

### `OAuth2CredentialProvider`

One generic Authorization Code (+ optional PKCE) client, shared by X, LinkedIn, GitHub, Gmail,
Calendar, and Notion. Every one of them supplies only an `OAuth2Config` — a description of
endpoints and quirks, not code:

```ts
export interface OAuth2Config {
  readonly providerId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly usePkce: boolean;
  readonly tokenAuthMethod: 'basic' | 'body' | 'none';
  readonly extraAuthorizationParams?: Readonly<Record<string, string>>;
}
```

This is the reason adding an OAuth provider is a config file rather than a flow
implementation.

## The connect flow

```
GET /providers/x/connect
        │
        │  buildAuthorizationUrl()
        │    · generate random `state`
        │    · generate PKCE verifier (if usePkce)
        │    · KV put oauth-state:x:<state> = { userId, codeVerifier }, TTL 600s
        ▼
302 → https://x.com/i/oauth2/authorize?...&code_challenge=...&state=...
        │
        │  user approves
        ▼
GET /providers/x/callback?code=...&state=...
        │
        │  handleCallback()
        │    · KV get oauth-state:x:<state>  → 400 if absent/expired
        │    · KV delete (single-use)
        │    · POST tokenEndpoint with code + code_verifier
        │    · CredentialStore.save('x', userId, credential)
        ▼
HTML "Connected"
```

Three properties fall out of this:

- **CSRF resistance.** The callback is only honored if `state` matches a record this server
  created. An attacker-supplied callback has no matching key.
- **Code-interception resistance.** With PKCE, the authorization code alone is useless without
  the verifier, which never left KV.
- **Correct user attribution.** The pending record carries the `userId` from the connect
  request, so the credential is filed against whoever started the flow — not whoever's browser
  finished it.

Pending authorizations expire after 10 minutes. Take longer and you get
`Unknown or expired OAuth state. Restart the connect flow.`

### Refresh

`getCredential()` is the only thing tools ever call, and it handles expiry itself:

```ts
const isExpired = stored.expiresAt !== undefined && stored.expiresAt - REFRESH_SKEW_MS <= now();
```

`REFRESH_SKEW_MS` is 60 seconds — refresh slightly early so a token doesn't die in flight
between the check and the upstream call. If refresh is needed and there's no refresh token,
you get `AuthRequiredError` and the user reconnects.

Providers that rotate refresh tokens return a new one and it's persisted; providers that don't
get the old one carried forward. Both work without provider-specific code.

This is why getting a refresh token matters more than it looks. X only issues one if you
request `offline.access`; Google only if you send both `access_type=offline` and
`prompt=consent`. Miss it and the connection silently dies a couple of hours later.

## Storage

| Key | Contents | TTL |
| --- | --- | --- |
| `cred:<providerId>:<userId>` | `ProviderCredential`, encrypted if configured | none |
| `oauth-state:<providerId>:<state>` | Pending authorization + PKCE verifier | 600s |
| `mcp-token:<sha256(token)>` | Server-issued access grant (`oauth2` strategy) | none — checked against `expiresAt` |

The `cred:` namespacing is the isolation boundary: the `x` provider constructs keys from its
own id, so it structurally cannot read `cred:github:*`.

When `CREDENTIAL_ENCRYPTION_KEY` is set, `CredentialStore` encrypts the serialized credential
with AES-256-GCM before writing. The stored form is `base64(iv).base64(ciphertext)` with a
fresh 12-byte IV per write. The key must decode to exactly 32 bytes:

```bash
openssl rand -base64 32
```

Without the key, credentials are stored as plaintext JSON. It's optional so local development
works with zero setup — set it in production.

> Rotating the key orphans every stored credential; `decryptString` throws and each provider
> must be reconnected. There is no migration path.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /providers` | Every provider with its credential kind, tool count, and connect URL |
| `GET /providers/:id/connect` | Starts the flow — 302 to the provider's consent screen |
| `GET /providers/:id/callback` | Completes it; renders a plain HTML result page |
| `GET /providers/:id/status` | `{ id, credentialKind, connected }` |
| `POST /providers/:id/disconnect` | Deletes the stored credential from KV |

Two things to know about these:

- They are **not** behind `requireAuth` — the middleware is mounted on `/mcp` only. A provider
  callback arrives from the provider's redirect, which can't carry your MCP bearer token. The
  flow's own protection is the unguessable, single-use, short-lived `state`.
- `disconnect` deletes the local credential; it does **not** revoke the grant upstream. Do that
  in the provider's own settings if you want the token dead at the source.

The callback page is deliberately austere: escaped text, no scripts, no external assets. It's
rendered from an OAuth redirect, so it treats everything in the query string as hostile.

## Provider quirks

Every one of these is a real interoperability difference that cost a debugging session
somewhere. They're encoded in each `config.ts` so nobody rediscovers them.

| Provider | PKCE | Token auth | Notes |
| --- | --- | --- | --- |
| X | yes (required) | `basic` | `offline.access` scope is what produces a refresh token |
| LinkedIn | no | `body` | Token endpoint rejects PKCE; also needs a `YYYYMM` version header on REST calls |
| GitHub | no | `body` | OAuth Apps don't support PKCE |
| Gmail | yes | `body` | `access_type=offline` + `prompt=consent` to force refresh-token re-issue |
| Calendar | yes | `body` | Same; falls back to the Gmail Google app's client id/secret if its own aren't set |
| Notion | no | `basic` | No OAuth scopes at all — capabilities come from the integration's settings. Sends `owner=user` |

## Setting up a provider app

1. Register an OAuth app in the provider's developer console.
2. Set the redirect URI to `https://<your-worker>.workers.dev/providers/<id>/callback` — it
   must match `<PROVIDER>_REDIRECT_URI` byte for byte, including trailing slash.
3. Request the scopes in that provider's `*_SCOPES` constant.
4. `wrangler secret put <PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI`.
5. Visit `/providers/<id>/connect` in a browser.

Where the consoles live: [X](https://developer.x.com),
[LinkedIn](https://www.linkedin.com/developers/apps),
[GitHub](https://github.com/settings/developers),
[Google](https://console.cloud.google.com/apis/credentials),
[Notion](https://www.notion.so/my-integrations).

For local development, use `http://127.0.0.1:8787/providers/<id>/callback` and register that
too. Most providers allow a loopback redirect; a few insist on HTTPS, in which case you'll
need a tunnel.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Provider "x" is not configured.` on `/connect` | Client id / secret / redirect URI secrets unset |
| `Unknown or expired OAuth state.` | Over 10 minutes elapsed, or the callback hit a different deployment than the one that started the flow |
| Token endpoint 400 `invalid_client` | `tokenAuthMethod` mismatch — provider wants Basic and got body credentials, or vice versa |
| Token endpoint 400 on `code_verifier` | `usePkce` set for a provider that doesn't support it |
| `redirect_uri_mismatch` | Registered URI differs from `<PROVIDER>_REDIRECT_URI` (scheme, port, trailing slash all count) |
| Works, then `AUTH_REQUIRED` an hour later | No refresh token — missing `offline.access` / `access_type=offline` + `prompt=consent` |
| `AUTH_REQUIRED` immediately after connecting | `CREDENTIAL_ENCRYPTION_KEY` changed between write and read |
| `Malformed encrypted payload.` | Credential written without the key, read with it (or vice versa) |
| `must decode to exactly 32 bytes` | Key not generated with `openssl rand -base64 32` |
| Every `/mcp` request 401s under `AUTH_STRATEGY=oauth2` | No issuer is minting grants — see [above](#oauth2) |
