import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { stripeProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('stripeProvider', () => {
  it('declares its id and credential kind', () => {
    expect(stripeProvider.id).toBe('stripe');
    expect(stripeProvider.credential.kind).toBe('api-key');
    expect(stripeProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(stripeProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'stripe_create_payment_link',
      'stripe_list_customers',
    ]);
    for (const tool of stripeProvider.tools) {
      expect(tool.name.startsWith('stripe_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of stripeProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of stripeProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});
