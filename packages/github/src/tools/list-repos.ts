import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  visibility: z
    .enum(['all', 'public', 'private'])
    .default('all')
    .describe('Filter repositories by visibility.'),
  sort: z
    .enum(['created', 'updated', 'pushed', 'full_name'])
    .default('updated')
    .describe('Field to sort the results by.'),
  perPage: z.number().int().min(1).max(100).default(30).describe('Results per page (1-100).'),
});

const outputSchema = z.object({
  repositories: z.array(
    z.object({
      id: z.number().int(),
      fullName: z.string().describe('owner/repo'),
      description: z.string().optional(),
      private: z.boolean(),
      url: z.string(),
      defaultBranch: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export const listReposTool = createTool({
  name: 'github_list_repos',
  title: 'List GitHub repositories',
  description:
    'Lists repositories accessible to the connected GitHub account, filterable by ' +
    'visibility and sortable. Read-only.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with a GithubClient calling GET /user/repos, mapping the response
  // onto outputSchema. See packages/x/src/client.ts for the reference client shape.
  execute: async () => {
    throw new NotImplementedError('github_list_repos');
  },
});
