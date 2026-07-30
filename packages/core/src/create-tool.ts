import type { z } from 'zod';
import type { ToolDefinition } from './types.js';

/**
 * Identity helper that lets TypeScript infer a tool's argument type from its Zod schema.
 * Annotating the object literal by hand instead would force you to restate the input type
 * and keep it in sync with the schema.
 */
export function createTool<TInputSchema extends z.ZodTypeAny, TOutput = unknown>(
  definition: ToolDefinition<TInputSchema, TOutput>,
): ToolDefinition<TInputSchema, TOutput> {
  return definition;
}
