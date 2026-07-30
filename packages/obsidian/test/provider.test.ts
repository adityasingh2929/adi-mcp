import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { obsidianProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('obsidianProvider', () => {
  it('declares its id and credential kind', () => {
    expect(obsidianProvider.id).toBe('obsidian');
    expect(obsidianProvider.credential.kind).toBe('bearer');
    expect(obsidianProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(obsidianProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'obsidian_append_to_note',
      'obsidian_search_notes',
    ]);
    for (const tool of obsidianProvider.tools) {
      expect(tool.name.startsWith('obsidian_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of obsidianProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of obsidianProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});
