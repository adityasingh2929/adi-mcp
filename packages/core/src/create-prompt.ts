import type { PromptArgsShape, PromptDefinition } from './types.js';

/**
 * Identity helper that lets TypeScript infer a prompt's argument types from its `argsSchema`,
 * mirroring {@link createTool}.
 */
export function createPrompt<TShape extends PromptArgsShape>(
  definition: PromptDefinition<TShape>,
): PromptDefinition<TShape> {
  return definition;
}
