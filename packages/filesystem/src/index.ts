import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';

export const FILESYSTEM_PROVIDER_ID = 'filesystem';

/**
 * Paths are relative to FILESYSTEM_ROOT. Absolute paths and `..` segments are rejected at the
 * schema level as a first line of defense; the implementation must *also* resolve the final
 * path and verify it still sits inside the root, since symlinks can escape a syntactic check.
 */
const sandboxedPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:/.test(value), {
    message: 'Path must be relative to the configured filesystem root.',
  })
  .refine((value) => !value.split(/[\\/]/).includes('..'), {
    message: 'Path may not contain ".." segments.',
  })
  .describe('Path relative to the configured filesystem root.');

const readFileTool = createTool({
  name: 'filesystem_read_file',
  title: 'Read a file',
  description:
    'Reads a UTF-8 text file from inside the configured sandbox root and returns its contents. ' +
    'Read-only. Paths outside the root are rejected.',
  inputSchema: z.object({
    path: sandboxedPath,
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(5_000_000)
      .default(1_000_000)
      .describe('Truncate the read at this many bytes.'),
  }),
  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
    bytes: z.number().int(),
    truncated: z.boolean(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement against the chosen storage backend (R2, a mounted volume, or node:fs
  // in a non-Workers deployment). Resolve the real path and re-check containment in the root
  // before reading — the schema checks above are not sufficient on their own.
  execute: async () => {
    throw new NotImplementedError('filesystem_read_file');
  },
});

const listDirectoryTool = createTool({
  name: 'filesystem_list_directory',
  title: 'List a directory',
  description:
    'Lists entries in a directory inside the sandbox root, with their type and size. ' +
    'Read-only. Use this to discover files before reading them.',
  inputSchema: z.object({
    path: sandboxedPath.default('.'),
    recursive: z.boolean().default(false).describe('Descend into subdirectories.'),
    maxEntries: z.number().int().min(1).max(10_000).default(1000),
  }),
  outputSchema: z.object({
    entries: z.array(
      z.object({
        path: z.string(),
        type: z.enum(['file', 'directory']),
        sizeBytes: z.number().int().optional(),
        modifiedAt: z.string().optional(),
      }),
    ),
    truncated: z.boolean(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement with the same containment check as filesystem_read_file.
  execute: async () => {
    throw new NotImplementedError('filesystem_list_directory');
  },
});

export const filesystemProvider: Provider = {
  id: FILESYSTEM_PROVIDER_ID,
  displayName: 'Filesystem',
  description:
    'Sandboxed read access to a configured directory root. Scaffold — tool schemas and path ' +
    'validation are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'local',
    description:
      'No external credentials. FILESYSTEM_ROOT defines the sandbox; every path is resolved ' +
      'relative to it and must stay within it.',
  },
  tools: [readFileTool, listDirectoryTool],
};
