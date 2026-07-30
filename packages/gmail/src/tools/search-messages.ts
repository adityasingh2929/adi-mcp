import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(2048)
    .describe(
      'Gmail search query using the same syntax as the Gmail search box, e.g. ' +
        '`from:someone@example.com is:unread newer_than:7d`.',
    ),
  maxResults: z.number().int().min(1).max(100).default(20).describe('Messages to return (1-100).'),
});

const outputSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      threadId: z.string(),
      from: z.string().optional(),
      subject: z.string().optional(),
      snippet: z.string().optional(),
      receivedAt: z.string().optional(),
    }),
  ),
  resultCount: z.number().int(),
});

export const searchMessagesTool = createTool({
  name: 'gmail_search_messages',
  title: 'Search Gmail messages',
  description:
    'Searches the connected mailbox using Gmail query syntax and returns message headers ' +
    'and snippets. Read-only — never sends, deletes, or modifies mail.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with GET /users/me/messages then batch GET each message's metadata.
  execute: async () => {
    throw new NotImplementedError('gmail_search_messages');
  },
});
