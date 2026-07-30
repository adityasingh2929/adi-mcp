import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  parentId: z
    .string()
    .min(1)
    .describe('Id of the parent page or database the new page is created under.'),
  parentType: z
    .enum(['page', 'database'])
    .default('page')
    .describe('Whether parentId refers to a page or a database.'),
  title: z.string().min(1).max(2000).describe('Title of the new page.'),
  content: z
    .string()
    .max(100_000)
    .optional()
    .describe('Body text. Each line becomes its own paragraph block.'),
});

const outputSchema = z.object({
  id: z.string(),
  url: z.string(),
});

export const createPageTool = createTool({
  name: 'notion_create_page',
  title: 'Create a Notion page',
  description:
    'Creates a page under an existing page or database. The parent must already be shared ' +
    'with the connected Notion integration, otherwise Notion rejects the request.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement with POST /v1/pages, converting `content` lines into paragraph blocks.
  execute: async () => {
    throw new NotImplementedError('notion_create_page');
  },
});
