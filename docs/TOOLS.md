# Writing tools

A tool is one object: its name, its docs for the model, its schemas, its safety annotations,
and its behavior — all in one file, all type-checked against each other.

```ts
import { z } from 'zod';
import { createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  text: z.string().min(1).max(280).describe('The text of the post. Maximum 280 characters.'),
});

const outputSchema = z.object({
  id: z.string().describe('The id of the newly created post.'),
  url: z.string().describe('Direct link to the published post.'),
});

export const postTweetTool = createTool({
  name: 'x_post_tweet',
  title: 'Post to X',
  description:
    "Publishes a new post to X on the authenticated user's behalf. Text is limited to 280 " +
    'characters. This action is public and immediate — confirm the exact wording with the ' +
    'user first.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: async (input, ctx) => {
    // input.text is `string` — inferred from the schema, not restated
    const response = await new XClient(ctx).request<CreatePostResponse>('/tweets', {
      method: 'POST',
      body: { text: input.text },
    });
    return { id: response.data.id, url: `https://x.com/i/web/status/${response.data.id}` };
  },
});
```

## Why `createTool`

It's an identity function. It returns exactly what you pass it. Its entire job is generic
inference:

```ts
export function createTool<TInputSchema extends z.ZodTypeAny, TOutput = unknown>(
  definition: ToolDefinition<TInputSchema, TOutput>,
): ToolDefinition<TInputSchema, TOutput>;
```

Because `TInputSchema` is inferred from the `inputSchema` you supplied, `execute`'s first
parameter is typed `z.infer<TInputSchema>` automatically. Annotate a bare object literal
instead and you'd have to restate the input type by hand and keep it in sync with the schema
forever.

One subtlety worth understanding, because the obvious alternative is wrong: `ToolDefinition`
is generic over **the schema**, not over the input type. If it were declared
`inputSchema: z.ZodType<TInput>`, TypeScript would resolve `TInput` to the schema's *input*
type — and for anything using `.default()`, input and output differ:

```ts
z.number().default(10)   // input: number | undefined     output: number
```

You'd be handed `number | undefined` in `execute` despite the default guaranteeing a value.
Parameterizing over the schema and using `z.infer` picks the **output** type, so defaults are
applied and optionals are narrowed correctly. `PromptDefinition` carries the same fix.

## Naming

Tool names must be **globally unique across the entire server** — every provider's tools land
in one flat MCP namespace. The convention is `${providerId}_${action}`:

```
x_post_tweet          github_list_repos       system_list_providers
x_search_recent_posts stripe_create_payment_link
```

`ProviderRegistry.register` throws `DuplicateToolError` if two providers claim the same name,
so a collision is a startup crash with a clear message rather than one tool silently shadowing
another.

`title` is the human label ("Post to X"); `name` is the wire identifier.

## Descriptions

The description is the tool's real interface. A model that misuses a tool usually had a
description that didn't tell it enough. Four things belong in one:

**What it does, concretely.** Not "interacts with posts" — "publishes a new post to X on the
authenticated user's behalf."

**Its limits.** "Searches posts from the last 7 days (the window the standard X API exposes)"
stops a model from trying to page back a month and reporting a bug when it can't.

**Its blast radius, when it has one.** `x_delete_post` says: "Permanently deletes one of the
authenticated account's posts. This cannot be undone — always confirm the exact post with the
user before calling."

**When *not* to reach for it.** "Read-only — never publishes anything" on the search tool
removes a real ambiguity.

Same care goes into `.describe()` on individual fields — that text reaches the model as part
of the JSON Schema:

```ts
query: z.string().min(1).max(512).describe(
  'X search query. Supports operators like `from:handle`, `#hashtag`, `-is:retweet`, ' +
    'and quoted phrases. Example: `from:anthropicai -is:retweet`.',
),
```

Worth the two extra lines: the model now knows the query grammar without guessing.

## Input schemas

Always a `z.object(...)`, even when empty (`z.object({})` for a no-argument tool). The MCP SDK
validates arguments against this schema before `execute` ever runs, so by the time your code
executes, the input is already valid and typed.

Push as much as possible into the schema — constraints there become part of the published
JSON Schema and steer the model *before* a bad call happens, rather than rejecting it after:

```ts
const inputSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(10, 'X requires at least 10 results per page.')
    .max(100)
    .default(10)
    .describe('How many posts to return (10-100).'),
  postId: z
    .string()
    .regex(/^\d+$/, 'Post ids are numeric strings.')
    .describe('The id of the post to delete. Must belong to the authenticated account.'),
  visibility: z.enum(['all', 'public', 'private']).default('all'),
});
```

Custom messages on `.min()` / `.regex()` are worth writing — they surface to the model
verbatim when validation fails, and "X requires at least 10 results per page" is actionable
where "Number must be greater than or equal to 10" isn't.

Use `.default()` freely; as covered above, the type machinery handles it.

## Output schemas

`outputSchema` is optional but recommended. When present, the bridge sends both a text
rendering and a `structuredContent` payload:

```ts
return tool.outputSchema
  ? { content: [{ type: 'text', text: toContentText(output) }], structuredContent: output }
  : { content: [{ type: 'text', text: toContentText(output) }] };
```

Clients that understand structured output get typed data; those that don't still get readable
pretty-printed JSON. **`structuredContent` is only emitted when `outputSchema` is declared** —
sending it otherwise makes spec-compliant clients reject the response, which is why the
conditional exists.

Shape the output for the consumer, not for the upstream API. Map snake_case to camelCase, drop
fields nobody needs, and add anything derived that saves the model a step — `x_post_tweet`
returns a ready-to-use `url` that the X API never sent:

```ts
return {
  id: response.data.id,
  text: response.data.text,
  url: `https://x.com/i/web/status/${response.data.id}`,
};
```

Note the conditional-spread idiom used throughout for optional fields, since the project runs
with `exactOptionalPropertyTypes` off but still avoids explicit `undefined`:

```ts
...(post.author_id ? { authorId: post.author_id } : {}),
```

## Annotations

Four hints that tell a client how dangerous a tool is. They're advisory — nothing enforces
them — but they drive confirmation prompts in real clients, so accuracy matters.

| Hint | Meaning |
| --- | --- |
| `readOnlyHint` | Never mutates external state |
| `destructiveHint` | May irreversibly delete or overwrite |
| `idempotentHint` | Calling twice with the same input ≡ calling once |
| `openWorldHint` | Talks to the open internet vs. a closed system |

The patterns in this repo:

```ts
// read
{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }

// create
{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }

// delete
{ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
```

Delete is idempotent and creation isn't — deleting an already-deleted post leaves the same end
state, while posting twice produces two posts. That distinction is exactly what a client needs
to decide whether a retry is safe.

## `execute`

```ts
execute(input: z.infer<TInputSchema>, ctx: ExecutionContext): Promise<TOutput>;
```

`ExecutionContext` carries everything a tool needs and nothing it doesn't:

```ts
interface ExecutionContext {
  readonly userId: string;    // whose credentials to use
  readonly env: Env;          // typed Worker bindings, vars, and secrets
  readonly logger: Logger;    // already bound to the request id and tool name
  readonly kv: KvStore;       // interface, not the raw namespace
  readonly requestId: string;
}
```

`kv` being an interface (`CloudflareKvStore` in production, `InMemoryKvStore` in tests) is what
lets tools be unit-tested with no Workers runtime at all.

Don't log arguments, tokens, or response bodies. The bridge already logs every invocation with
its duration and outcome; tool-level logging should add signal, not payloads.

Keep API access in a client class rather than inline `fetch` — credential resolution, error
translation, and `fetchImpl` injection are all things you'd otherwise rewrite per tool. See
`packages/x/src/client.ts`.

## Errors

Throw. Never return an error shape by hand. Every invocation is wrapped in exactly one place
(`apps/server/src/mcp-server.ts`), which funnels any throw through `toToolResult()`.

```ts
McpToolError            TOOL_ERROR         base class
├── NotImplementedError NOT_IMPLEMENTED    scaffold tool
├── AuthRequiredError   AUTH_REQUIRED      provider not connected
├── ValidationError     VALIDATION_ERROR   invalid beyond what Zod can express
├── RateLimitError      RATE_LIMITED       quota exceeded (carries retryAfterSeconds)
└── UpstreamApiError    UPSTREAM_ERROR     third-party API returned an error (carries status)
```

The result is a well-formed MCP error, and the HTTP response is still **200**:

```json
{
  "content": [{ "type": "text", "text": "[AUTH_REQUIRED] No credentials found for provider \"x\". Connect it first via /providers/x/connect." }],
  "isError": true
}
```

That's what the spec calls for, and it's what makes the failure *useful*: the model reads the
error and acts on it. `AUTH_REQUIRED` tells it the exact URL to send the user to.
`NOT_IMPLEMENTED` tells it to stop retrying. A raw 500 would tell it nothing.

Anything that isn't an `McpToolError` still gets caught and returned as `INTERNAL_ERROR` with
its message — the server never crashes on a tool throw.

Use `ValidationError` for rules the schema can't express. The canonical example is X's
character limit:

```ts
// Count by code points: emoji are one character to X but two UTF-16 units to `String.length`,
// so a naive length check rejects valid posts.
const codePointLength = [...input.text].length;
if (codePointLength > MAX_POST_LENGTH) {
  throw new ValidationError(`Post is ${codePointLength} characters; the limit is ${MAX_POST_LENGTH}.`);
}
```

`z.string().max(280)` counts UTF-16 units, so a post with emoji can be under X's real limit and
still fail the schema. The schema stays as the cheap first filter; the tool does the exact
check.

Error translation belongs in the client, once, not in every tool:

```ts
if (response.status === 429) {
  const resetAt = Number.parseInt(response.headers.get('x-rate-limit-reset') ?? '', 10);
  throw new RateLimitError(Number.isFinite(resetAt) ? Math.max(1, resetAt - nowSeconds) : 60);
}
if (!response.ok) {
  throw new UpstreamApiError(X_PROVIDER_ID, response.status, await describeError(response));
}
```

## Scaffold tools

A tool that isn't implemented yet is still a real, registered, discoverable tool — complete
schemas, complete annotations, and an `execute` that throws:

```ts
  // SCAFFOLD: implement with a GithubClient calling GET /user/repos, mapping the response
  // onto outputSchema. See packages/x/src/client.ts for the reference client shape.
  execute: async () => {
    throw new NotImplementedError('github_list_repos');
  },
```

The model gets a clear "this is a scaffold, don't retry" message instead of a mystery failure,
and filling it in later touches nothing but the function body.

## Testing

Tools are tested against a stubbed `fetch` — no network, no interceptors. The fixtures live in
`packages/x/test/helpers.ts`: `makeConnectedContext()` (an `ExecutionContext` over
`InMemoryKvStore` with a credential pre-saved), `makeDisconnectedContext()`, `stubFetch()`,
and `requestUrl` / `requestInit` for asserting on what was actually sent.

```ts
it('posts the text and returns a usable url', async () => {
  const fetchMock = stubFetch(jsonResponse({ data: { id: '123', text: 'hello' } }));
  const result = await postTweetTool.execute({ text: 'hello' }, await makeConnectedContext());

  expect(result.url).toBe('https://x.com/i/web/status/123');
  expect(JSON.parse(requestInit(fetchMock).body ?? '{}')).toMatchObject({ text: 'hello' });
});

it('surfaces AuthRequiredError when the provider is not connected', async () => {
  await expect(postTweetTool.execute({ text: 'hi' }, makeDisconnectedContext())).rejects.toThrow(
    AuthRequiredError,
  );
});
```

Cover, at minimum: the success path including any derived output fields; the disconnected path;
each error translation (401, 429 with and without a reset header, 5xx); and whatever the schema
can't enforce. Schema validation itself is worth a few direct `safeParse` assertions —
they're cheap and they catch a loosened constraint immediately.

## Checklist

- [ ] `name` is `${providerId}_${action}` and unique server-wide
- [ ] `description` covers what it does, its limits, its blast radius, and when not to use it
- [ ] Every input field has `.describe()`; constraints live in the schema with custom messages
- [ ] `outputSchema` declared, shaped for the consumer, with derived conveniences
- [ ] `annotations` honest about read-only / destructive / idempotent
- [ ] `execute` throws typed errors; API access goes through a client with injectable `fetch`
- [ ] Tests cover success, disconnected, and each error translation
