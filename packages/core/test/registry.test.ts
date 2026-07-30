import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTool } from '../src/create-tool.js';
import { createResource } from '../src/create-resource.js';
import { createPrompt } from '../src/create-prompt.js';
import { DuplicateProviderError, DuplicateToolError, ProviderRegistry } from '../src/registry.js';
import type { Provider } from '../src/types.js';

function makeProvider(id: string, toolNames: string[]): Provider {
  return {
    id,
    displayName: id,
    description: `${id} provider`,
    credential: { kind: 'none', description: 'no credentials needed' },
    tools: toolNames.map((name) =>
      createTool({
        name,
        description: `${name} tool`,
        inputSchema: z.object({}),
        execute: async () => ({}),
      }),
    ),
    resources: [
      createResource({
        uri: `${id}://status`,
        name: `${id}-status`,
        read: async () => [],
      }),
    ],
    prompts: [
      createPrompt({
        name: `${id}_prompt`,
        build: async () => [],
      }),
    ],
  };
}

describe('ProviderRegistry', () => {
  it('registers a provider and exposes its tools/resources/prompts', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('github', ['github_list_repos']));

    expect(registry.getProviders()).toHaveLength(1);
    expect(registry.getTool('github_list_repos')?.name).toBe('github_list_repos');
    expect(registry.getTools()).toHaveLength(1);
    expect(registry.getResources()).toHaveLength(1);
    expect(registry.getPrompts()).toHaveLength(1);
  });

  it('registerAll registers multiple providers at once', () => {
    const registry = new ProviderRegistry();
    registry.registerAll([
      makeProvider('github', ['github_list_repos']),
      makeProvider('x', ['x_post_tweet']),
    ]);

    expect(
      registry
        .getProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(['github', 'x']);
    expect(registry.getTools()).toHaveLength(2);
  });

  it('throws DuplicateProviderError on a repeated provider id', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('github', []));

    expect(() => registry.register(makeProvider('github', []))).toThrow(DuplicateProviderError);
  });

  it('throws DuplicateToolError when two providers register the same tool name', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('github', ['shared_name']));

    expect(() => registry.register(makeProvider('x', ['shared_name']))).toThrow(DuplicateToolError);
  });

  it('does not partially register a provider whose tool name collides', () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider('github', ['shared_name']));

    try {
      registry.register(makeProvider('x', ['shared_name']));
    } catch {
      // expected
    }

    expect(registry.getProvider('x')).toBeUndefined();
    expect(registry.getProviders()).toHaveLength(1);
  });

  it('getProvider/getTool return undefined for unknown ids', () => {
    const registry = new ProviderRegistry();
    expect(registry.getProvider('missing')).toBeUndefined();
    expect(registry.getTool('missing')).toBeUndefined();
  });
});
