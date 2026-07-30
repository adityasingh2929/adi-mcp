import type { Env } from '@adi-mcp/shared';
import type { z } from 'zod';
import type { KvStore } from './kv-store.js';
import type { Logger } from './logger.js';

/** Per-request context passed to every tool/resource/prompt handler. */
export interface ExecutionContext {
  /** Stable identifier for the caller. For a single-tenant deployment this is a fixed value. */
  readonly userId: string;
  readonly env: Env;
  readonly logger: Logger;
  readonly kv: KvStore;
  readonly requestId: string;
}

export interface ToolAnnotations {
  /** Tool only reads data, never mutates external state. */
  readonly readOnlyHint?: boolean;
  /** Tool may irreversibly delete or overwrite data. */
  readonly destructiveHint?: boolean;
  /** Calling the tool twice with the same input has the same effect as calling it once. */
  readonly idempotentHint?: boolean;
  /** Tool interacts with a wider "open world" (the public internet) vs. a closed system. */
  readonly openWorldHint?: boolean;
}

/**
 * A single MCP tool. `name` must be globally unique across the whole server —
 * by convention `${providerId}_${action}` (e.g. `x_post_tweet`).
 */
export interface ToolDefinition<
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly annotations?: ToolAnnotations;
  /**
   * Receives `z.infer` of the input schema — the schema's *output* type, so `.default()`
   * and other transforms are already applied and the value is fully narrowed.
   */
  execute(input: z.infer<TInputSchema>, ctx: ExecutionContext): Promise<TOutput>;
}

/** Type-erased tool, used only where a heterogeneous collection is unavoidable (registries, lists). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- collections of generically-typed tools require erasure at the container boundary
export type AnyToolDefinition = ToolDefinition<z.ZodTypeAny, any>;

/**
 * Contents of a resource read. A resource is either text or binary (base64 `blob`), never
 * both and never neither — modeled as a union so the MCP wire format can't be violated.
 */
export type ResourceContent =
  | { readonly uri: string; readonly mimeType?: string; readonly text: string }
  | { readonly uri: string; readonly mimeType?: string; readonly blob: string };

/**
 * A single MCP resource or resource template. `uri` may contain `{placeholders}`
 * (RFC 6570), in which case `isTemplate` must be `true`.
 */
export interface ResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly isTemplate?: boolean;
  read(uri: string, ctx: ExecutionContext): Promise<ResourceContent[]>;
}

export interface PromptMessage {
  readonly role: 'user' | 'assistant';
  readonly content: { readonly type: 'text'; readonly text: string };
}

/**
 * Raw shape of a prompt's arguments. MCP prompt arguments are always strings on the wire,
 * so each entry is a string schema (optionally `.optional()`), matching the SDK's
 * `PromptArgsRawShape` — not a wrapping `z.object(...)`.
 */
export type PromptArgsShape = Record<string, z.ZodType<string | undefined>>;

/** Arguments a prompt's `build` receives, derived from its `argsSchema`. */
export type PromptArgs<TShape extends PromptArgsShape> = {
  [K in keyof TShape]: z.infer<TShape[K]>;
};

/**
 * A reusable prompt template. `build` receives `z.infer` of each entry in `argsSchema`, so
 * arguments the schema marks `.optional()` arrive as `string | undefined`.
 */
export interface PromptDefinition<TShape extends PromptArgsShape = PromptArgsShape> {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly argsSchema?: TShape;
  build(args: PromptArgs<TShape>, ctx: ExecutionContext): Promise<PromptMessage[]>;
}

/** Type-erased prompt, for heterogeneous collections. */
export type AnyPromptDefinition = PromptDefinition<PromptArgsShape>;

export type CredentialKind = 'oauth2' | 'api-key' | 'bearer' | 'local' | 'none';

/** Describes what a provider needs to authenticate — implementations live in @adi-mcp/auth. */
export interface CredentialRequirement {
  readonly kind: CredentialKind;
  readonly description: string;
  readonly scopes?: readonly string[];
}

/**
 * A fully self-contained integration. Every provider package exports exactly one of these
 * (plus, optionally, a Hono sub-app for OAuth connect/callback routes — kept separate so
 * this package never depends on a specific HTTP framework).
 */
export interface Provider {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly credential: CredentialRequirement;
  readonly tools: readonly AnyToolDefinition[];
  readonly resources?: readonly ResourceDefinition[];
  readonly prompts?: readonly AnyPromptDefinition[];
}
