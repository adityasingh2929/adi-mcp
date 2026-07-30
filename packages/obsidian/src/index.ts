import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';
import { StaticCredentialProvider } from '@adi-mcp/auth';

export const OBSIDIAN_PROVIDER_ID = 'obsidian';

export const obsidianCredentialProvider = new StaticCredentialProvider(
  OBSIDIAN_PROVIDER_ID,
  'bearer',
  'OBSIDIAN_API_KEY',
);

const vaultPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.split(/[\\/]/).includes('..'), {
    message: 'Path may not contain ".." segments.',
  })
  .describe('Note path relative to the vault root, including the .md extension.');

const searchNotesTool = createTool({
  name: 'obsidian_search_notes',
  title: 'Search Obsidian notes',
  description:
    'Full-text searches the vault and returns matching notes with surrounding context. ' +
    'Read-only. Requires the Local REST API community plugin to be running.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('Text to search for across note contents.'),
    maxResults: z.number().int().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    notes: z.array(
      z.object({
        path: z.string(),
        score: z.number().optional(),
        excerpt: z.string().optional(),
      }),
    ),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement against the Local REST API plugin's POST /search/simple/ endpoint at
  // OBSIDIAN_API_URL, authenticating with the bearer credential.
  execute: async () => {
    throw new NotImplementedError('obsidian_search_notes');
  },
});

const appendToNoteTool = createTool({
  name: 'obsidian_append_to_note',
  title: 'Append to an Obsidian note',
  description:
    'Appends text to the end of a note, creating the note if it does not exist. Existing ' +
    'content is never overwritten — this only adds to the end of the file.',
  inputSchema: z.object({
    path: vaultPath,
    content: z.string().min(1).max(100_000).describe('Markdown to append.'),
    createIfMissing: z.boolean().default(true),
  }),
  outputSchema: z.object({
    path: z.string(),
    created: z.boolean().describe('True when the note did not previously exist.'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  // SCAFFOLD: implement with the plugin's POST /vault/{path} (append semantics).
  execute: async () => {
    throw new NotImplementedError('obsidian_append_to_note');
  },
});

export const obsidianProvider: Provider = {
  id: OBSIDIAN_PROVIDER_ID,
  displayName: 'Obsidian',
  description:
    'Search and append to notes in an Obsidian vault via the Local REST API plugin. ' +
    'Scaffold — tool schemas and credential wiring are complete; tool execution is not yet ' +
    'implemented.',
  credential: {
    kind: 'bearer',
    description:
      'Requires the Obsidian Local REST API plugin, its OBSIDIAN_API_KEY as a Worker secret, ' +
      'and OBSIDIAN_API_URL pointing at the plugin. Since the plugin binds to localhost, a ' +
      'deployed Worker needs a tunnel to reach it.',
  },
  tools: [searchNotesTool, appendToNoteTool],
};
