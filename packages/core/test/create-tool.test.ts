import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../src/logger.js';
import { InMemoryKvStore } from '../src/kv-store.js';
import { createTool } from '../src/create-tool.js';
import type { ExecutionContext } from '../src/types.js';

describe('createTool', () => {
  it('returns the definition unchanged (identity) with inferred input/output types', async () => {
    const echoTool = createTool({
      name: 'test_echo',
      description: 'Echoes the input message',
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ echoed: z.string() }),
      execute: async (input) => ({ echoed: input.message }),
    });

    expect(echoTool.name).toBe('test_echo');

    const ctx: ExecutionContext = {
      userId: 'test-user',
      env: {} as ExecutionContext['env'],
      logger: createLogger(),
      kv: new InMemoryKvStore(),
      requestId: 'req-1',
    };

    const parsedInput = echoTool.inputSchema.parse({ message: 'hi' });
    const result = await echoTool.execute(parsedInput, ctx);
    expect(result).toEqual({ echoed: 'hi' });
  });
});
