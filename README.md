# Adi MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that exposes tools
from many services through **one endpoint**, deployed on Cloudflare Workers.

Every integration lives in its own package and knows nothing about any other. Adding a
provider means creating a folder and adding one line to a registration array — no existing
code changes.

```
MCP client (Claude, etc.)
        │  Streamable HTTP + bearer/OAuth
        ▼
   ┌─────────────┐
   │  /mcp       │  Hono on Cloudflare Workers
   │  CORS · security headers · auth · rate limit
   └──────┬──────┘
          │  ProviderRegistry
   ┌──────┴───────────────────────────────────┐
   │  x   linkedin   github   gmail   notion  │  …13 providers + system
   └──────┬───────────────────────────────────┘
          │  per-provider credentials (KV, encrypted)
          ▼
   third-party APIs
```

## Status

| Provider | Auth | State |
| --- | --- | --- |
| **X** | OAuth 2.0 + PKCE | **Implemented** — post, read profile, search, delete |
| **LinkedIn** | OAuth 2.0 | **Implemented** — read profile, share post |
| GitHub | OAuth 2.0 | Scaffold |
| Gmail | Google OAuth 2.0 | Scaffold |
| Google Calendar | Google OAuth 2.0 | Scaffold |
| Notion | OAuth 2.0 | Scaffold |
| Obsidian | Bearer (Local REST API plugin) | Scaffold |
| Postgres | Connection string | Scaffold |
| Supabase | Service-role key | Scaffold |
| Stripe | API key | Scaffold |
| Resend | API key | Scaffold |
| Filesystem | Sandboxed local root | Scaffold |
| Browser | Browser Rendering / CDP | Scaffold |
| _system_ | none | **Implemented** — server introspection |

**Scaffold** means the package is structurally complete — real Zod schemas, real validation,
real credential wiring, registered and discoverable over MCP — but `execute()` throws a
`NotImplementedError` that MCP clients receive as a normal tool error. Filling one in means
writing its API client; nothing else has to change. See
[docs/ADDING_PROVIDERS.md](docs/ADDING_PROVIDERS.md).

## Quickstart

```bash
pnpm install
```

Create `apps/server/.dev.vars` (wrangler's local secrets file — it does **not** read `.env`):

```bash
MCP_BEARER_TOKEN=some-long-random-string
LOG_LEVEL=debug
```

Start the server:

```bash
pnpm dev
```

Then check it is alive:

```bash
curl http://127.0.0.1:8787/health
```

```json
{ "status": "ok", "server": "adi-mcp", "version": "0.1.0", "providers": 14, "tools": 29 }
```

List the tools over MCP:

```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H "Authorization: Bearer some-long-random-string" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Connecting a client

Point any MCP client at `https://<your-worker>.workers.dev/mcp` with an
`Authorization: Bearer <MCP_BEARER_TOKEN>` header. The server advertises its auth scheme at
`/.well-known/oauth-protected-resource` so compliant clients can discover it after a 401.

Provider credentials are separate from that token — connect each service once via
`/providers/<id>/connect`. See [docs/OAUTH.md](docs/OAUTH.md).

## Commands

```bash
pnpm dev              # wrangler dev on :8787
pnpm test             # all 294 tests
pnpm test:coverage    # with coverage report
pnpm typecheck        # tsc across every package
pnpm lint             # eslint, type-aware
pnpm format           # prettier
pnpm build            # wrangler dry-run bundle
pnpm scaffold:provider <id> "<Name>" <credential-kind>
```

Local Postgres for the postgres provider:

```bash
docker compose up -d postgres
```

## Documentation

| Doc | What's in it |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Layers, request lifecycle, why it's built this way |
| [Deployment](docs/DEPLOYMENT.md) | KV setup, secrets, deploying to Cloudflare |
| [Adding providers](docs/ADDING_PROVIDERS.md) | Step-by-step new integration |
| [OAuth](docs/OAUTH.md) | Both auth layers explained end to end |
| [Tools](docs/TOOLS.md) | Writing tools: schemas, validation, errors, docs |
| [Resources & prompts](docs/RESOURCES_AND_PROMPTS.md) | The other two MCP primitives |

## Layout

```
apps/server/        Cloudflare Worker: Hono app, MCP endpoint, OAuth routes
packages/core/      Provider/Tool/Resource/Prompt types, registry, logger, errors, KV, rate limit
packages/auth/      Auth strategies + credential providers (OAuth2, API key, bearer)
packages/<id>/      One isolated package per integration
shared/             Env bindings and constants shared across packages
scripts/            Provider scaffolding script
docs/               The docs above
```

## License

MIT
