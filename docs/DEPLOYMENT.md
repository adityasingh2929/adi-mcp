# Deployment

Deploying Adi MCP is four things: a KV namespace, a set of secrets, a `wrangler deploy`, and
a smoke test. Everything else is already in `apps/server/wrangler.jsonc`.

## Prerequisites

- Node 22+ and pnpm 11.18 (`npm install -g pnpm` — corepack can fail with `EPERM` on Windows)
- A Cloudflare account (the free Workers plan is enough)
- `wrangler` — already a dev dependency, so `pnpm exec wrangler` works without a global install

```bash
pnpm install
```

Authenticate once:

```bash
pnpm exec wrangler login
```

## 1. Create the KV namespace

One namespace backs all three key spaces — credentials, OAuth state, and rate-limit counters.

```bash
cd apps/server && pnpm exec wrangler kv namespace create ADI_MCP_KV
```

```bash
cd apps/server && pnpm exec wrangler kv namespace create ADI_MCP_KV --preview
```

Each command prints an id. Paste them into `apps/server/wrangler.jsonc`, replacing the
placeholders:

```jsonc
"kv_namespaces": [
  {
    "binding": "ADI_MCP_KV",
    "id": "<id from the first command>",
    "preview_id": "<id from the --preview command>",
  },
],
```

The `preview_id` is what `wrangler dev` uses when it runs against remote resources; local
`wrangler dev` uses Miniflare's on-disk KV and needs neither.

If you also want the staging environment, repeat for `--env staging` and fill in
`REPLACE_WITH_STAGING_KV_NAMESPACE_ID`. Otherwise delete the `env.staging` block.

## 2. Set secrets

Non-secret configuration lives in `wrangler.jsonc` under `vars`. Everything below is a
secret and must be set with `wrangler secret put`, which stores it encrypted at Cloudflare
and never writes it to the repo.

### Required

```bash
cd apps/server && pnpm exec wrangler secret put MCP_BEARER_TOKEN
```

Generate a value first — this is the only thing standing between the internet and your
connected accounts:

```bash
openssl rand -base64 48
```

### Strongly recommended

`CREDENTIAL_ENCRYPTION_KEY` encrypts every stored provider token at rest with AES-256-GCM.
Without it, credentials sit in KV as plaintext JSON. It must decode to exactly 32 bytes:

```bash
openssl rand -base64 32
```

```bash
cd apps/server && pnpm exec wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

> Rotating this key invalidates every stored credential — `decryptString` will throw and
> users have to reconnect each provider. There is no re-encryption path; treat rotation as a
> deliberate reset.

### Per provider

Only set secrets for providers you actually intend to use. An unconfigured provider still
registers and lists its tools; calling one returns a normal `AUTH_REQUIRED` tool error.

| Provider | Secrets |
| --- | --- |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` |
| Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` |
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI` |
| Obsidian | `OBSIDIAN_API_URL`, `OBSIDIAN_API_KEY` |
| Postgres | `POSTGRES_CONNECTION_STRING` |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Stripe | `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Resend | `RESEND_API_KEY` |
| Filesystem | `FILESYSTEM_ROOT` |
| Browser | `BROWSER_REMOTE_ENDPOINT`, `BROWSER_API_KEY` |

Redirect URIs must be the deployed origin, not localhost:
`https://<worker>.<subdomain>.workers.dev/providers/<id>/callback`. Since you don't know the
origin until after the first deploy, the usual order is: deploy once, read the URL, then set
the redirect URIs and redeploy. See [OAUTH.md](OAUTH.md) for where each provider's app is
registered.

`.env.example` lists every variable with the same grouping.

## 3. Review the vars

`apps/server/wrangler.jsonc` ships with:

```jsonc
"vars": {
  "LOG_LEVEL": "info",
  "AUTH_STRATEGY": "bearer",
  "RATE_LIMIT_MAX_REQUESTS": "60",
  "RATE_LIMIT_WINDOW_SECONDS": "60",
  "CORS_ALLOWED_ORIGINS": "https://claude.ai",
},
```

Worth changing before you deploy:

- **`CORS_ALLOWED_ORIGINS`** — comma-separated allow-list, matched exactly. Add your client's
  origin if it isn't Claude. `*` allows everything and should stay out of production.
- **`RATE_LIMIT_*`** — a fixed window per authenticated principal (falling back to
  `cf-connecting-ip`). 60/minute is comfortable for one interactive client.
- **`AUTH_STRATEGY`** — leave on `bearer` unless you are running multi-tenant. See
  [OAUTH.md](OAUTH.md#server-level-auth).

## 4. Deploy

Verify the bundle builds before you push it:

```bash
cd apps/server && pnpm exec wrangler deploy --dry-run --outdir dist
```

Then:

```bash
cd apps/server && pnpm exec wrangler deploy
```

Wrangler prints the deployed URL. Staging, if configured:

```bash
cd apps/server && pnpm exec wrangler deploy --env staging
```

## 5. Verify

```bash
curl https://<your-worker>.workers.dev/health
```

```json
{ "status": "ok", "server": "adi-mcp", "version": "0.1.0", "providers": 14, "tools": 29 }
```

`/health` is intentionally unauthenticated — it reports counts, never credentials.

Confirm auth is actually enforced (this must be a 401):

```bash
curl -i -X POST https://<your-worker>.workers.dev/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Then a real call. Note the `Accept` header — the Streamable HTTP transport requires both
media types, and omitting it gets you a 406:

```bash
curl -s -X POST https://<your-worker>.workers.dev/mcp -H "Authorization: Bearer $MCP_BEARER_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

And the provider inventory:

```bash
curl https://<your-worker>.workers.dev/providers
```

## Connecting a client

Point the client at `https://<your-worker>.workers.dev/mcp` with header
`Authorization: Bearer <MCP_BEARER_TOKEN>`.

The server publishes `/.well-known/oauth-protected-resource` (RFC 9728), and every 401 carries
a `WWW-Authenticate` header pointing at it, so clients that implement MCP authorization can
discover the scheme on their own.

Then connect each provider once by visiting `https://<your-worker>.workers.dev/providers/<id>/connect`
in a browser.

## Continuous deployment

`.github/workflows/deploy.yml` runs lint, typecheck, and tests, then `wrangler deploy` on
every push to `main`. It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN` — an API token with the **Edit Cloudflare Workers** template
- `CLOUDFLARE_ACCOUNT_ID`

The workflow does **not** manage Worker secrets. `wrangler secret put` stays a manual,
out-of-band step — CI never sees your provider credentials.

`.github/workflows/ci.yml` runs the same checks plus `format:check`, a coverage upload, and a
dry-run bundle on every PR.

## Local development

`wrangler dev` reads secrets from `apps/server/.dev.vars` — **not** `.env`, which it ignores
entirely. Copy `.env.example` there and fill in what you need:

```bash
cp .env.example apps/server/.dev.vars
```

```bash
pnpm dev
```

Two things that cost time if you don't know them:

- `.dev.vars` does not hot-reload. Editing it requires restarting `wrangler dev`.
- Local `wrangler dev` uses Miniflare's simulated KV, so you don't need a real namespace to
  develop — but the `id` placeholders in `wrangler.jsonc` must be replaced before any
  `deploy` or any `--remote` run.

For the postgres provider:

```bash
docker compose up -d postgres
```

`docker-compose.yml` also defines a `server` service that runs `wrangler dev` in a container
with the repo mounted. It's a convenience for a clean-room environment; production never runs
in that container — Workers run on Cloudflare's edge.

## Operations

**Logs.** Observability is enabled in `wrangler.jsonc`, so logs land in the Cloudflare
dashboard. To tail live:

```bash
cd apps/server && pnpm exec wrangler tail
```

Every log line carries the request id also returned in the `X-Request-Id` response header,
which is how you correlate a client-side failure with a server-side trace.

**Rotating the bearer token.** Run `wrangler secret put MCP_BEARER_TOKEN` again and update the
client. There is no grace period — the old token stops working as soon as the new value
propagates.

**Disconnecting a provider.**

```bash
curl -X POST https://<your-worker>.workers.dev/providers/x/disconnect
```

This deletes the stored credential from KV. It does not revoke the grant at the provider —
do that in the provider's own settings if you want the token dead upstream too.

**Rollback.**

```bash
cd apps/server && pnpm exec wrangler rollback
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Server is misconfigured: MCP_BEARER_TOKEN is not set.` | Secret missing, or set on the wrong environment. Check `wrangler secret list`. |
| 403 `Invalid bearer token.` | Token mismatch — often a trailing newline from a here-doc when the secret was set. |
| 406 on `POST /mcp` | Client didn't send `Accept: application/json, text/event-stream`. |
| CORS failure in a browser client | Origin missing from `CORS_ALLOWED_ORIGINS` (exact match, no wildcards within an entry). |
| `AUTH_REQUIRED` from every tool of one provider | That provider was never connected via `/providers/<id>/connect`, or its credential was encrypted under a rotated key. |
| `Provider "x" is not configured.` on `/connect` | Client id/secret/redirect URI secrets are unset for that provider. |
| `Unknown or expired OAuth state.` | The connect flow took longer than 10 minutes, or the callback hit a different deployment than the one that started it. |
| `CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes` | Key wasn't generated with `openssl rand -base64 32`. |
| 429 with `Retry-After` | Rate limit. Raise `RATE_LIMIT_MAX_REQUESTS` or widen the window. |
