import type {
  AnyPromptDefinition,
  AnyToolDefinition,
  Provider,
  ResourceDefinition,
} from './types.js';

export class DuplicateProviderError extends Error {
  constructor(id: string) {
    super(`Provider "${id}" is already registered.`);
    this.name = 'DuplicateProviderError';
  }
}

export class DuplicateToolError extends Error {
  constructor(name: string, providerId: string) {
    super(
      `Tool "${name}" from provider "${providerId}" collides with a tool of the same name ` +
        `already registered by another provider. Tool names must be globally unique.`,
    );
    this.name = 'DuplicateToolError';
  }
}

/**
 * Collects every {@link Provider} the server knows about and exposes flattened, validated
 * views over their tools/resources/prompts. This is the single place adding a provider
 * "shows up" in the running server.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  private readonly toolIndex = new Map<string, AnyToolDefinition>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new DuplicateProviderError(provider.id);
    }
    for (const tool of provider.tools) {
      if (this.toolIndex.has(tool.name)) {
        throw new DuplicateToolError(tool.name, provider.id);
      }
    }

    this.providers.set(provider.id, provider);
    for (const tool of provider.tools) {
      this.toolIndex.set(tool.name, tool);
    }
  }

  registerAll(providers: readonly Provider[]): void {
    for (const provider of providers) this.register(provider);
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getProviders(): Provider[] {
    return [...this.providers.values()];
  }

  getTool(name: string): AnyToolDefinition | undefined {
    return this.toolIndex.get(name);
  }

  getTools(): AnyToolDefinition[] {
    return [...this.toolIndex.values()];
  }

  getResources(): ResourceDefinition[] {
    return this.getProviders().flatMap((provider) => provider.resources ?? []);
  }

  getPrompts(): AnyPromptDefinition[] {
    return this.getProviders().flatMap((provider) => provider.prompts ?? []);
  }
}
