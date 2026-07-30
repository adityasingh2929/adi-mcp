import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { notionProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('notionProvider', () => {
  it('declares its id and credential kind', () => {
    expect(notionProvider.id).toBe('notion');
    expect(notionProvider.credential.kind).toBe('oauth2');
    expect(notionProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(notionProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'notion_create_page',
      'notion_search',
    ]);
    for (const tool of notionProvider.tools) {
      expect(tool.name.startsWith('notion_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of notionProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of notionProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});
