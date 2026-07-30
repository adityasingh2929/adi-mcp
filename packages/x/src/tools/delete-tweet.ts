import { z } from 'zod';
import { createTool } from '@adi-mcp/core';
import { XClient } from '../client.js';

const inputSchema = z.object({
  postId: z
    .string()
    .regex(/^\d+$/, 'Post ids are numeric strings.')
    .describe('The id of the post to delete. Must belong to the authenticated account.'),
});

const outputSchema = z.object({
  deleted: z.boolean(),
  postId: z.string(),
});

interface DeleteResponse {
  readonly data?: { readonly deleted?: boolean };
}

export const deleteTweetTool = createTool({
  name: 'x_delete_post',
  title: 'Delete an X post',
  description:
    "Permanently deletes one of the authenticated account's posts. This cannot be undone — " +
    'always confirm the exact post with the user before calling.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  execute: async (input, ctx) => {
    const response = await new XClient(ctx).request<DeleteResponse>(`/tweets/${input.postId}`, {
      method: 'DELETE',
    });

    return { deleted: response.data?.deleted ?? true, postId: input.postId };
  },
});
