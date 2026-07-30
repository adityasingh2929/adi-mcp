import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  query: z
    .string()
    .max(1000)
    .default('')
    .describe('Text to match against page and database titles.'),
  filterType: z
    .enum(['page', 'database'])
    .optional()
    .describe('Restrict results to only pages or only databases.'),
  pageSize: z.number().int().min(1).max(100).default(25),
});

const outputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      objectType: z.string().describe('"page" or "database".'),
      title: z.string().optional(),
      url: z.string().optional(),
      lastEditedTime: z.string().optional(),
    }),
  ),
  hasMore: z.boolean(),
});

export const searchTool = createTool({
  name: 'notion_search',
  title: 'Search Notion',
  description:
    'Searches pages and databases the connected Notion integration has been granted access ' +
    'to. Only content explicitly shared with the integration is visible. Read-only.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with POST /v1/search, sending the Notion-Version header.
  execute: async () => {
    throw new NotImplementedError('notion_search');
  },
});
