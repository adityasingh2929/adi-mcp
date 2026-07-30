import type { Env } from '@adi-mcp/shared';
import type { ExecutionContext, KvStore, Logger } from '@adi-mcp/core';
import type { AuthenticatedPrincipal } from '@adi-mcp/auth';

/** Values this app attaches to Hono's per-request context. */
export interface AppVariables {
  readonly requestId: string;
  readonly logger: Logger;
  readonly kv: KvStore;
  principal?: AuthenticatedPrincipal;
}

export interface AppBindings {
  Bindings: Env;
  Variables: AppVariables;
}

/** Assembles the {@link ExecutionContext} handed to every tool, resource, and prompt. */
export function buildExecutionContext(
  env: Env,
  vars: AppVariables,
  userId: string,
): ExecutionContext {
  return {
    userId,
    env,
    logger: vars.logger,
    kv: vars.kv,
    requestId: vars.requestId,
  };
}
