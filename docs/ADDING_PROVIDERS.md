# Adding a provider

A provider is a folder plus one line in an array. Nothing already in the repo has to change.

This walks the whole path with a fictional `linear` provider. If you just want the checklist,
skip to [the summary](#summary).

## 0. Scaffold

```bash
pnpm scaffold:provider linear "Linear" oauth2
```

The last argument is the credential kind: `oauth2`, `api-key`, `bearer`, `local`, or `none`.

That writes `packages/linear/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, an
`src/index.ts` exporting a stub `Provider`, and empty `src/tools/` and `test/` directories.
Then:

```bash
pnpm install
```

pnpm needs to re-link the new workspace package before anything can import it.

The script deliberately stops at the boilerplate — it does not touch
`apps/server/src/providers.ts`, because a codegen'd edit to the one file that decides what
the server exposes is worse than a one-line manual edit.

## 1. Config: endpoints and credentials

`packages/linear/src/config.ts` holds the provider's constants and its credential factory.
An OAuth provider composes `OAuth2CredentialProvider` with a static `OAuth2Config` — it never
implements the redirect dance itself:

```ts
import type { Env } from '@adi-mcp/shared';
import type { CredentialStore, OAuth2Config } from '@adi-mcp/auth';
import { OAuth2CredentialProvider } from '@adi-mcp/auth';

export const LINEAR_PROVIDER_ID = 'linear';
export const LINEAR_API_BASE_URL = 'https://api.linear.app/graphql';

export const LINEAR_SCOPES = ['read', 'write'] as const;

export function buildLinearOAuthConfig(env: Env): OAuth2Config {
  return {
    providerId: LINEAR_PROVIDER_ID,
    authorizationEndpoint: 'https://linear.app/oauth/authorize',
    tokenEndpoint: 'https://api.linear.app/oauth/token',
    clientId: env.LINEAR_CLIENT_ID ?? '',
    ...(env.LINEAR_CLIENT_SECRET ? { clientSecret: env.LINEAR_CLIENT_SECRET } : {}),
    redirectUri: env.LINEAR_REDIRECT_URI ?? '',
    scopes: LINEAR_SCOPES,
    usePkce: false,
    tokenAuthMethod: 'body',
  };
}

export function createLinearCredentialProvider(
  env: Env,
  store: CredentialStore,
): OAuth2CredentialProvider {
  return new OAuth2CredentialProvider(buildLinearOAuthConfig(env), store);
}
```

`usePkce` and `tokenAuthMethod` are where real providers differ, and getting them wrong
produces confusing 400s from the token endpoint. Check the existing configs before guessing —
X requires PKCE and Basic auth, GitHub allows neither PKCE nor Basic, Notion wants Basic
without PKCE, Google wants PKCE plus `access_type=offline`. [OAUTH.md](OAUTH.md#provider-quirks)
tabulates all of them.

For an API-key provider, skip all of this and use `StaticCredentialProvider` instead — see
[step 5](#5-non-oauth-providers).

Add the new env vars to `shared/src/env.ts`:

```ts
  // ── Linear ──
  readonly LINEAR_CLIENT_ID?: string;
  readonly LINEAR_CLIENT_SECRET?: string;
  readonly LINEAR_REDIRECT_URI?: string;
```

Every secret name in the system is declared in that one interface, which is what keeps
`env.LINEAR_CLIENT_ID` type-checked instead of a stringly-typed lookup. Mirror them into
`.env.example` with a comment saying where the app is registered.

Optionally add the id to `PROVIDER_IDS` in `shared/src/constants.ts`. That list is pure
documentation — no runtime behavior reads it.

## 2. A client

`packages/linear/src/client.ts` wraps the upstream API: resolve credential, shape request,
translate errors. Model it on `packages/x/src/client.ts`. The parts that matter:

```ts
export class LinearClient {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<TResponse>(query: string): Promise<TResponse> {
    const store = new CredentialStore(this.ctx.kv, this.ctx.env.CREDENTIAL_ENCRYPTION_KEY);
    const credential = await createLinearCredentialProvider(this.ctx.env, store).getCredential({
      userId: this.ctx.userId,
      env: this.ctx.env,
      kv: this.ctx.kv,
      logger: this.ctx.logger,
    });
    // ...
  }
}
```

Three conventions, each earning its keep:

- **`fetchImpl` is injected**, defaulting to global `fetch`. That is the entire test strategy
  for provider packages — no network, no interceptors, no nock.
- **Refresh is not your problem.** `getCredential` transparently refreshes an expired token
  and re-persists it. Throw nothing, catch nothing.
- **Translate errors into the core hierarchy.** A 429 becomes `RateLimitError` (read the
  provider's reset header if it has one); anything else non-2xx becomes `UpstreamApiError`
  carrying the upstream's own message. See [TOOLS.md](TOOLS.md#errors).

## 3. Tools

One file per tool under `src/tools/`. Full treatment in [TOOLS.md](TOOLS.md); the shape:

```ts
export const listIssuesTool = createTool({
  name: 'linear_list_issues',
  title: 'List Linear issues',
  description: 'Lists issues assigned to the connected user, newest first. Read-only.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  execute: async (input, ctx) => { /* ... */ },
});
```

Tool names must be globally unique across the entire server, so prefix every one with the
provider id. `ProviderRegistry` throws `DuplicateToolError` at boot if two providers collide —
loudly and at startup, rather than silently shadowing.

## 4. The provider object

`packages/linear/src/index.ts` exports exactly one `Provider`, plus its credential factory for
the server to wire into the OAuth routes:

```ts
export {
  LINEAR_PROVIDER_ID,
  buildLinearOAuthConfig,
  createLinearCredentialProvider,
} from './config.js';

export const linearProvider: Provider = {
  id: LINEAR_PROVIDER_ID,
  displayName: 'Linear',
  description: 'Read and create Linear issues via the Linear GraphQL API.',
  credential: {
    kind: 'oauth2',
    description:
      'OAuth 2.0. Requires LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, and LINEAR_REDIRECT_URI. ' +
      'Connect at /providers/linear/connect.',
    scopes: LINEAR_SCOPES,
  },
  tools: [listIssuesTool, createIssueTool],
  // resources: [...],  // optional — see RESOURCES_AND_PROMPTS.md
  // prompts: [...],
};
```

`credential.description` is user-facing: it surfaces through `system_list_providers` and
`/providers`, so write it for whoever has to set the thing up.

## 5. Non-OAuth providers

For a provider that authenticates with a single long-lived key, there is no config module and
no connect flow — one `StaticCredentialProvider` reads the key straight out of the Worker env:

```ts
export const linearCredentialProvider = new StaticCredentialProvider(
  LINEAR_PROVIDER_ID,
  'api-key',
  'LINEAR_API_KEY',
);
```

The third argument is `keyof Env`, so a typo is a compile error rather than a runtime
`undefined`. `packages/stripe/src/index.ts` is the reference. Skip step 6 entirely — these
providers have nothing to connect, and `/providers/<id>/status` reports them connected
whenever the secret is present.

## 6. Register it

Two edits in `apps/server/src/providers.ts`. Workers bundles statically, so registration
cannot be discovered at runtime — this is the one file that has to change.

```ts
import { linearProvider, createLinearCredentialProvider } from '@adi-mcp/linear';

const PROVIDERS: readonly Provider[] = [
  // ...
  linearProvider,
];

const OAUTH_PROVIDER_FACTORIES: Readonly<Record<string, OAuthProviderFactory>> = {
  // ...
  linear: createLinearCredentialProvider,
};
```

The second entry is what gives you `/providers/linear/connect`, `/callback`, `/status`, and
`/disconnect` for free. Omit it for non-OAuth providers.

Add the dependency to `apps/server/package.json`:

```jsonc
"@adi-mcp/linear": "workspace:*",
```

```bash
pnpm install
```

## 7. Tests

`test/provider.test.ts` — structural checks that hold regardless of implementation state:

```ts
describe('linearProvider', () => {
  it('prefixes every tool name with the provider id', () => {
    for (const tool of linearProvider.tools) {
      expect(tool.name.startsWith('linear_')).toBe(true);
    }
  });

  it('rejects input that violates the schema', () => {
    expect(listIssuesTool.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});
```

`test/tools.test.ts` — behavior, against a stubbed `fetch`. `packages/x/test/helpers.ts` has
the fixture pattern: a fake `ExecutionContext` over `InMemoryKvStore` plus a `fetch` double
returning canned `Response` objects. Cover the success path, each error translation
(401 → `AUTH_REQUIRED`, 429 → `RateLimitError`, 5xx → `UpstreamApiError`), and whatever edge
case the schema can't express.

If the tools are still scaffolds, assert that they surface `NotImplementedError` rather than
crashing — that is a real guarantee worth locking in.

```bash
pnpm test && pnpm lint && pnpm typecheck
```

## 8. Verify it's live

```bash
pnpm dev
```

```bash
curl http://127.0.0.1:8787/health
```

The `providers` and `tools` counts should both have gone up. Then confirm the tools actually
reached the MCP surface:

```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H "Authorization: Bearer $MCP_BEARER_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

For an OAuth provider, put its credentials in `apps/server/.dev.vars` (restart afterwards —
it does not hot-reload), set the redirect URI to
`http://127.0.0.1:8787/providers/linear/callback`, register that same URI in the provider's
developer console, and visit `http://127.0.0.1:8787/providers/linear/connect`.

## Filling in a scaffold

The eleven scaffold providers have finished schemas, credential wiring, registration, and
tests; only `execute()` is missing. Converting one is steps 2, 3, and 7 — write the client,
replace each `throw new NotImplementedError(...)` with real logic, add behavior tests. The
`// SCAFFOLD:` comment on each tool names the endpoint to call.

Nothing else moves. The provider is already registered, already discoverable, already
connectable.

## Summary

| Step | File | Required |
| --- | --- | --- |
| Scaffold | `pnpm scaffold:provider <id> "<Name>" <kind>` | yes |
| Env vars | `shared/src/env.ts`, `.env.example` | if it needs secrets |
| Config | `packages/<id>/src/config.ts` | OAuth only |
| Client | `packages/<id>/src/client.ts` | if it calls an API |
| Tools | `packages/<id>/src/tools/*.ts` | yes |
| Provider | `packages/<id>/src/index.ts` | yes |
| Register | `apps/server/src/providers.ts` | yes |
| Dependency | `apps/server/package.json` | yes |
| Tests | `packages/<id>/test/*.test.ts` | yes |

Everything above `Register` is additive. The registration line is the only edit to existing
code, and it is one line — which is the whole point of the architecture.
