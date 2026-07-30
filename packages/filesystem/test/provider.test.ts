import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { filesystemProvider } from '../src/index.js';

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('filesystemProvider', () => {
  it('declares its id and credential kind', () => {
    expect(filesystemProvider.id).toBe('filesystem');
    expect(filesystemProvider.credential.kind).toBe('local');
    expect(filesystemProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(filesystemProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'filesystem_list_directory',
      'filesystem_read_file',
    ]);
    for (const tool of filesystemProvider.tools) {
      expect(tool.name.startsWith('filesystem_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of filesystemProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of filesystemProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('filesystem path sandboxing', () => {
  const readFile = filesystemProvider.tools.find((t) => t.name === 'filesystem_read_file')!;

  it('accepts a relative path inside the root', () => {
    expect(readFile.inputSchema.safeParse({ path: 'notes/todo.md' }).success).toBe(true);
  });

  it('rejects an absolute POSIX path', () => {
    expect(readFile.inputSchema.safeParse({ path: '/etc/passwd' }).success).toBe(false);
  });

  it('rejects an absolute Windows path', () => {
    expect(readFile.inputSchema.safeParse({ path: String.raw`C:\Windows\System32` }).success).toBe(
      false,
    );
  });

  it('rejects traversal via ..', () => {
    expect(readFile.inputSchema.safeParse({ path: '../../secrets.env' }).success).toBe(false);
    expect(readFile.inputSchema.safeParse({ path: 'a/../../b' }).success).toBe(false);
  });

  it('rejects traversal using backslash separators', () => {
    expect(readFile.inputSchema.safeParse({ path: String.raw`a\..\..\b` }).success).toBe(false);
  });

  it('does not reject filenames that merely contain dots', () => {
    expect(readFile.inputSchema.safeParse({ path: 'my..file.md' }).success).toBe(true);
  });
});
