import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { browserProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('browserProvider', () => {
  it('declares its id and credential kind', () => {
    expect(browserProvider.id).toBe('browser');
    expect(browserProvider.credential.kind).toBe('api-key');
    expect(browserProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(browserProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'browser_fetch_page',
      'browser_screenshot',
    ]);
    for (const tool of browserProvider.tools) {
      expect(tool.name.startsWith('browser_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of browserProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of browserProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('browser URL validation', () => {
  const fetchPage = browserProvider.tools.find((t) => t.name === 'browser_fetch_page')!;

  it('accepts http and https URLs', () => {
    expect(fetchPage.inputSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(fetchPage.inputSchema.safeParse({ url: 'http://example.com' }).success).toBe(true);
  });

  it('rejects file:// URLs so the headless browser cannot read local files', () => {
    expect(fetchPage.inputSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('rejects other non-http schemes', () => {
    expect(fetchPage.inputSchema.safeParse({ url: 'ftp://example.com' }).success).toBe(false);
    expect(fetchPage.inputSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('applies a default timeout', () => {
    const parsed = fetchPage.inputSchema.parse({ url: 'https://example.com' }) as {
      timeoutMs: number;
    };
    expect(parsed.timeoutMs).toBe(15_000);
  });
});
