import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { supabaseProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('supabaseProvider', () => {
  it('declares its id and credential kind', () => {
    expect(supabaseProvider.id).toBe('supabase');
    expect(supabaseProvider.credential.kind).toBe('api-key');
    expect(supabaseProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(supabaseProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'supabase_insert_row',
      'supabase_query_table',
    ]);
    for (const tool of supabaseProvider.tools) {
      expect(tool.name.startsWith('supabase_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of supabaseProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of supabaseProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('supabase identifier validation', () => {
  const queryTable = supabaseProvider.tools.find((t) => t.name === 'supabase_query_table')!;

  it('accepts a valid table identifier', () => {
    expect(queryTable.inputSchema.safeParse({ table: 'user_profiles' }).success).toBe(true);
  });

  it('rejects identifiers containing SQL/PostgREST metacharacters', () => {
    for (const table of ['users; drop table x', 'users.other', 'users-1', '"users"', '1users']) {
      expect(queryTable.inputSchema.safeParse({ table }).success).toBe(false);
    }
  });

  it('applies select and limit defaults', () => {
    const parsed = queryTable.inputSchema.parse({ table: 'users' }) as {
      select: string;
      limit: number;
      ascending: boolean;
    };
    expect(parsed.select).toBe('*');
    expect(parsed.limit).toBe(100);
    expect(parsed.ascending).toBe(true);
  });
});
