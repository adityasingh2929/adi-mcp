# Resources and prompts

Tools are the primitive everyone reaches for first. MCP has two others, and each answers a
question tools answer badly.

| Primitive | Controlled by | Use it for |
| --- | --- | --- |
| **Tool** | The model decides when to call | Doing something, or fetching something that depends on arguments |
| **Resource** | The client decides what to attach | Context the model should be able to *read* by URI |
| **Prompt** | The user explicitly invokes | A reusable, parameterized instruction the user picks from a menu |

The distinction that matters: a tool is model-driven, a prompt is user-driven, and a resource
is application-driven. If you find yourself writing a tool whose only job is "return this
document," it's a resource. If you're writing a tool whose description is really an instruction
for how the model should behave, it's a prompt.

Both are optional on `Provider`, and providers declare them the same way they declare tools:

```ts
export const xProvider: Provider = {
  // ...
  tools: [postTweetTool, getMeTool, searchPostsTool, deleteTweetTool],
  prompts: [composePostPrompt],
};
```

`ProviderRegistry` flattens `resources` and `prompts` across every provider, and
`createMcpServer` registers all three primitive types the same way. The system provider
(`apps/server/src/system-provider.ts`) is the reference implementation for both — it's the one
provider that exposes all three.

---

# Resources

A resource is addressable, readable context. The client attaches it; the model reads it.

```ts
createResource({
  uri: 'system://health',
  name: 'server-health',
  title: 'Server health',
  description: 'Current server version, uptime marker, and registered provider count.',
  mimeType: 'application/json',
  read: async (uri) => [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ status: 'ok', /* ... */ }, null, 2),
    },
  ],
});
```

`createResource` is an identity helper like `createTool` — it exists so authoring stays
uniform, not because it needs generic inference.

## Static vs. template

A resource whose `uri` contains `{placeholders}` (RFC 6570) is a **template**, and must set
`isTemplate: true`. That flag chooses which SDK registration path the bridge takes:

```ts
if (resource.isTemplate) {
  server.registerResource(resource.name, new ResourceTemplate(resource.uri, { list: undefined }), config, read);
} else {
  server.registerResource(resource.name, resource.uri, config, read);
}
```

Set the placeholder without the flag and the client will treat the literal `{providerId}`
string as an address.

Templates receive the **resolved** URI, so parse it inside `read`:

```ts
createResource({
  uri: 'system://providers/{providerId}',
  name: 'provider-detail',
  isTemplate: true,
  mimeType: 'application/json',
  read: async (uri) => {
    const providerId = uri.split('/').pop() ?? '';
    const provider = getRegistry().getProvider(providerId);

    if (!provider) {
      return [{ uri, mimeType: 'application/json', text: JSON.stringify({ error: `Unknown provider "${providerId}".` }, null, 2) }];
    }
    // ...
  },
});
```

Note that an unknown id returns a JSON error *document* rather than throwing. A resource read
is not a tool call — there's no `isError` channel — so an unresolvable URI should read as
content explaining why.

`list: undefined` on the `ResourceTemplate` means the server doesn't enumerate every possible
expansion. Provide a list callback only when the set is small and cheap to compute.

## Text or blob, never both

```ts
export type ResourceContent =
  | { uri: string; mimeType?: string; text: string }
  | { uri: string; mimeType?: string; blob: string };
```

Modeled as a union so the wire format can't be violated by construction — you can't
accidentally emit a resource with both fields or neither. `blob` is base64.

`read` returns an **array**, because one URI may legitimately resolve to several documents
(a directory, a multi-part export). Most return exactly one.

## Designing a URI scheme

Use a custom scheme naming the provider, and a path that reads like a hierarchy:

```
system://health
system://providers/{providerId}
notion://pages/{pageId}
obsidian://vault/{path}
```

Two rules worth holding to. Keep them **stable** — a client may have a resource pinned across
sessions, and a renamed URI is a broken reference. And keep them **cheap** — a resource read
can happen without the model asking, so a read that costs a slow paginated API call is better
expressed as a tool.

## When to add one

Good candidates: server or account state the model benefits from seeing without spending a
tool call; documents the user is likely to reference repeatedly; anything a client would
sensibly show in an "attach context" picker.

Bad candidates: anything with side effects; anything requiring arguments richer than a URI
path; anything expensive.

---

# Prompts

A prompt is a parameterized template the **user** invokes — typically surfaced as a slash
command or a menu item, never auto-triggered by the model.

```ts
const composePostPrompt = createPrompt({
  name: 'x_compose_post',
  title: 'Compose an X post',
  description:
    'Drafts a post for X from a topic, constrained to the 280-character limit, and asks for ' +
    'approval before anything is published.',
  argsSchema: {
    topic: z.string().describe('What the post should be about'),
    tone: z.string().optional().describe('Optional tone, e.g. "technical", "casual"'),
  },
  build: async (args) => [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          `Draft a post for X about: ${args.topic}\n` +
          (args.tone ? `Tone: ${args.tone}\n` : '') +
          '\nConstraints:\n' +
          '- Maximum 280 characters, counted by code points (emoji count as one).\n' +
          '- No hashtag spam; at most one or two if they genuinely add reach.\n' +
          '- Lead with the substance, not a hook cliché.\n' +
          '\nShow me the draft and the exact character count. Do not call `x_post_tweet` ' +
          'until I explicitly approve the wording.',
      },
    },
  ],
});
```

## `argsSchema` is a raw shape

This is the detail that trips people up. `argsSchema` is a plain record of Zod string
schemas — **not** a wrapping `z.object(...)`:

```ts
export type PromptArgsShape = Record<string, z.ZodType<string | undefined>>;
```

```ts
argsSchema: { topic: z.string(), tone: z.string().optional() }        // correct
argsSchema: z.object({ topic: z.string(), tone: z.string().optional() })  // wrong
```

That's what the SDK's `registerPrompt` expects (`PromptArgsRawShape`). MCP prompt arguments
are always strings on the wire, so every entry is a string schema, optionally `.optional()`.
Arguments marked optional arrive in `build` as `string | undefined` — `createPrompt` infers
per-key types via `PromptArgs<TShape>`, so the `args.tone ? ... : ''` guard above is
type-checked rather than defensive.

## Writing the message

`build` returns `PromptMessage[]` — `role: 'user' | 'assistant'`, text content. Almost always
a single user message.

What separates a prompt worth shipping from a wrapper around the user's own words:

**Encode the constraints the model can't infer.** "Maximum 280 characters, counted by code
points (emoji count as one)" is the same rule `x_post_tweet` enforces at runtime — stated up
front so the draft is valid the first time instead of after a rejected call.

**Encode taste.** "Lead with the substance, not a hook cliché." LinkedIn's equivalent: "Open
with the substance, not 'I am thrilled to announce'", and "aim for under 1300 characters so it
fits before 'see more'." These are the things a person learns after posting for a year, and
they're exactly what a template should carry.

**Gate the side effect.** Every publishing prompt here ends the same way:

> Do not call `x_post_tweet` until I explicitly approve the wording.

A prompt that drafts something publishable should name the tool it must not call yet. This is
the single highest-value line in a prompt attached to an irreversible action.

**Name tools explicitly** when the prompt is meant to orchestrate. `system_orient` opens with
"Call `system_list_providers` to see what integrations are available."

## Naming

Same convention as tools: `${providerId}_${action}` — `x_compose_post`,
`linkedin_compose_post`, `system_orient`. Unlike tools, prompt names aren't uniqueness-checked
by the registry, so the prefix is the only thing keeping two providers' "compose" prompts
apart. Use it.

## When to add one

Add a prompt when there's a repeated, opinionated way to use a provider's tools that the tool
descriptions themselves shouldn't carry. Tool descriptions should describe the tool; prompts
carry workflow and judgment.

Skip it when the tool description already says everything, or when the "prompt" is really just
a tool call with fixed arguments.

---

## Testing

Both are plain async functions over an `ExecutionContext` — no server, no transport:

```ts
it('renders the topic and omits the tone line when absent', async () => {
  const [message] = await composePostPrompt.build({ topic: 'shipping v1', tone: undefined }, ctx);
  expect(message.content.text).toContain('shipping v1');
  expect(message.content.text).not.toContain('Tone:');
  expect(message.content.text).toContain('Do not call `x_post_tweet`');
});

it('reports an unknown provider as a JSON document, not a throw', async () => {
  const [content] = await providerDetailResource.read('system://providers/nope', ctx);
  expect(JSON.parse(content.text)).toMatchObject({ error: expect.stringContaining('nope') });
});
```

The protocol layer is covered separately in `apps/server/test/mcp-protocol.test.ts`, which
drives real `resources/read` and `prompts/get` JSON-RPC calls through `app.fetch()`.

## Registration recap

Add them to the provider object and they're live — the registry flattens them and the bridge
registers them per request:

```ts
export const someProvider: Provider = {
  // ...
  tools: [/* ... */],
  resources: [healthResource, providerDetailResource],
  prompts: [orientPrompt],
};
```

One thing to watch when a resource or prompt needs to see the registry itself: the system
provider takes it as a **getter**, not a value, because the registry isn't fully populated
until every provider — including the system provider — has been registered.

```ts
export function createSystemProvider(getRegistry: () => ProviderRegistry): Provider
```
