import type { ResourceDefinition } from './types.js';

/** Identity helper, mirrors {@link createTool}, mainly for a consistent authoring pattern. */
export function createResource(definition: ResourceDefinition): ResourceDefinition {
  return definition;
}
