import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { postgresProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('postgresProvider', () => {
  it('declares its id and credential kind', () => {
    expect(postgresProvider.id).toBe('postgres');
    expect(postgresProvider.credential.kind).toBe('local');
    expect(postgresProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(postgresProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'postgres_describe_schema',
      'postgres_run_query',
    ]);
    for (const tool of postgresProvider.tools) {
      expect(tool.name.startsWith('postgres_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of postgresProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of postgresProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('postgres_run_query schema', () => {
  const runQuery = postgresProvider.tools.find((t) => t.name === 'postgres_run_query')!;

  it('defaults params to an empty array and maxRows to 500', () => {
    const parsed = runQuery.inputSchema.parse({ sql: 'select 1' }) as {
      params: unknown[];
      maxRows: number;
    };
    expect(parsed.params).toEqual([]);
    expect(parsed.maxRows).toBe(500);
  });

  it('rejects an empty statement', () => {
    expect(runQuery.inputSchema.safeParse({ sql: '' }).success).toBe(false);
  });

  it('accepts parameterized values of the supported scalar types', () => {
    const result = runQuery.inputSchema.safeParse({
      sql: 'select * from t where a = $1 and b = $2 and c = $3 and d = $4',
      params: ['text', 42, true, null],
    });
    expect(result.success).toBe(true);
  });

  it('documents itself as read-only', () => {
    expect(runQuery.annotations?.readOnlyHint).toBe(true);
    expect(runQuery.description).toMatch(/read-only/i);
  });
});
