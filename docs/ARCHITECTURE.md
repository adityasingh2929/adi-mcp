# Architecture

## The problem this shape solves

An MCP server that aggregates many services tends to rot in a predictable way: provider code
leaks into the transport layer, OAuth gets reimplemented per integration, and adding the
eleventh provider means touching the other ten.

Adi MCP pushes back on that with one rule: **a provider is a value, not a code path.** Each
integration exports a plain `Provider` object. The server never branches on provider identity
— it iterates a registry. That is what makes "add a folder, add a line" true rather than
aspirational.

## Layers

```
┌──────────────────────────────────────────────────────────┐
│ apps/server                                              │
│   Hono app · middleware · /mcp · OAuth routes            │
│   Bridges ProviderRegistry → MCP SDK                     │
└────────────────────────┬─────────────────────────────────┘
                         │ depends on
┌────────────────────────┴─────────────────────────────────┐
│ packages/<provider>                                      │
│   Provider object: tools, resources, prompts, credential │
│   API client · Zod schemas · config                      │
└────────────────────────┬─────────────────────────────────┘
                         │ depends on
┌────────────────────────┴─────────────────────────────────┐
│ packages/auth                                            │
│   AuthStrategy (who may call /mcp)                       │
│   CredentialProvider (how a provider reaches its API)    │
└────────────────────────┬─────────────────────────────────┘
                         │ depends on
┌────────────────────────┴─────────────────────────────────┐
│ packages/core            shared/                         │
│   Types · registry · logger · errors · KV · rate limit   │
└──────────────────────────────────────────────────────────┘
```

Dependencies point strictly downward. `core` knows nothing about HTTP, Hono, or the MCP SDK —
which is why its 30 unit tests need no server, no network, and no Workers runtime.

## The `Provider` contract

Everything a provider must expose (`packages/core/src/types.ts`):

```ts
interface Provider {
  id: string;
  displayName: string;
  description: string;
  credential: CredentialRequirement;
  tools: readonly AnyToolDefinition[];
  resources?: readonly ResourceDefinition[];
  prompts?: readonly AnyPromptDefinition[];
}
```

A tool is similarly self-describing — schema, docs, annotations, and behavior in one object:

```ts
interface ToolDefinition<TInputSchema extends z.ZodTypeAny, TOutput> {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema?: z.ZodType<TOutput>;
  annotations?: ToolAnnotations;
  execute(input: z.infer<TInputSchema>, ctx: ExecutionContext): Promise<TOutput>;
}
```

`execute` receives `z.infer` of the schema — the schema's **output** type, so `.default()`
values are already applied and optional fields are correctly narrowed. This is why tools are
authored through `createTool()`: it lets TypeScript infer the argument type from the schema
instead of making you restate and hand-sync it.

## Request lifecycle

A `POST /mcp` travels through:

1. **`requestContext`** — assigns a correlation id, builds a logger bound to it, wraps the KV
   binding. Runs first so even error handlers log coherently.
2. **`securityHeaders`** — CSP, `X-Frame-Options`, HSTS, `no-store`.
3. **`cors`** — origin resolved per request from `CORS_ALLOWED_ORIGINS`.
4. **`requireAuth`** — the configured `AuthStrategy`. On failure: a JSON-RPC-shaped error plus
   a `WWW-Authenticate` challenge so clients can discover how to authenticate.
5. **`rateLimit`** — after auth, deliberately, so an authenticated caller gets its own bucket
   instead of sharing one with everyone behind the same NAT.
6. **MCP handler** — builds an `McpServer`, connects a `StreamableHTTPTransport`, hands off.

### Why stateless

The `/mcp` handler creates a **fresh `McpServer` and transport per request**
(`sessionIdGenerator: undefined`).

Workers isolates are not guaranteed to survive between requests, so in-memory MCP sessions
would break under exactly the conditions edge deploys are meant to handle. Statelessness
means any isolate can serve any request. The cost is re-registering tools per request —
cheap, since registration is building plain objects, and the registry itself is built once per
isolate.

One subtlety this forces: the server must **not** be closed after `handleRequest` resolves.
SSE bodies stream after that point, so an eager `close()` truncates the response. Cleanup is
attached to `transport.onclose` instead (`apps/server/src/app.ts`).

## Two independent auth layers

These are constantly conflated, so they are kept structurally separate.

**Server-level** — who may talk to this MCP server at all. One `AuthStrategy`, selected by
`AUTH_STRATEGY`:
- `bearer` — a static token from a Worker secret. The right default for a personal server.
- `oauth2` — validates OAuth 2.1 access tokens this server issued, looked up in KV **by
  SHA-256 hash**, so a KV dump alone cannot be replayed.

**Provider-level** — how a given integration reaches its third-party API. One
`CredentialProvider` per provider:
- `OAuth2CredentialProvider` — generic Authorization Code (+ PKCE) client with automatic
  refresh, shared by X, LinkedIn, GitHub, Google, and Notion. No provider reimplements the flow.
- `StaticCredentialProvider` — reads a long-lived API key or bearer token from env.

Credentials are namespaced `cred:<providerId>:<userId>` in KV and encrypted with AES-256-GCM
when `CREDENTIAL_ENCRYPTION_KEY` is set, so one provider can never read another's tokens.

Full detail in [OAUTH.md](OAUTH.md).

## Errors never crash the server

`packages/core/src/errors.ts` defines a small hierarchy — `NotImplementedError`,
`AuthRequiredError`, `ValidationError`, `RateLimitError`, `UpstreamApiError` — all extending
`McpToolError` with a machine-readable `code`.

Every tool invocation is wrapped at exactly one place (`apps/server/src/mcp-server.ts`), which
funnels any throw through `toToolResult()`. The result is a well-formed MCP error:

```json
{
  "content": [{ "type": "text", "text": "[AUTH_REQUIRED] No credentials found for provider \"x\". Connect it first via /providers/x/connect." }],
  "isError": true
}
```

The HTTP request still returns 200 — the failure is carried inside the tool result, which is
what the MCP spec calls for and what lets a model read the error and act on it. A model that
sees `AUTH_REQUIRED` learns the exact URL to send the user to; one that sees `NOT_IMPLEMENTED`
learns to stop retrying.

Unexpected throws are caught by Hono's `onError`, logged with a stack, and returned as a
generic 500 — internals are never leaked to the caller.

## Storage

Workers KV holds three key spaces, all prefixed (`shared/src/constants.ts`):

| Prefix | Contents | TTL |
| --- | --- | --- |
| `cred:<provider>:<user>` | Provider credentials, encrypted | none |
| `oauth-state:<provider>:<state>` | Pending PKCE authorizations | 10 min |
| `ratelimit:<key>:<window>` | Fixed-window counters | 2 × window |

KV is eventually consistent, so a burst of concurrent requests against one rate-limit key can
overshoot slightly. That is an accepted tradeoff: the alternative (Durable Objects) adds a
stateful component and local-dev complexity that this traffic profile does not justify.

`KvStore` is an interface with two implementations — `CloudflareKvStore` and
`InMemoryKvStore` — which is what lets the entire framework be unit-tested without the Workers
runtime.

## Testing strategy

281 tests, no network access, three tiers:

- **Unit** (`core`, `auth`) — pure logic against `InMemoryKvStore`. Includes real crypto:
  AES-GCM round-trips, PKCE derivation, timing-safe comparison.
- **Provider** (`x`, `linkedin`) — tools against a stubbed `fetch`, covering success, every error
  translation path, and edge cases like emoji code-point counting.
- **Integration** (`server`) — the real Hono app driven through `app.fetch()` with a fake KV
  namespace, exercising actual JSON-RPC: `initialize`, `tools/list`, `tools/call`,
  `resources/read`, `prompts/get`, plus auth, CORS, and rate limiting.

Scaffold providers are tested for what actually exists: schema validation, correct
registration, and that they surface `NotImplementedError` rather than crashing.
