import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const inputSchema = z.object({
  owner: z.string().min(1).describe('Repository owner (user or organization).'),
  repo: z.string().min(1).describe('Repository name, without the owner prefix.'),
  title: z.string().min(1).max(256).describe('Issue title.'),
  body: z.string().max(65_536).optional().describe('Issue body in GitHub-flavored Markdown.'),
  labels: z.array(z.string()).max(100).optional().describe('Labels to apply to the new issue.'),
  assignees: z.array(z.string()).max(10).optional().describe('GitHub usernames to assign.'),
});

const outputSchema = z.object({
  number: z.number().int().describe('Issue number within the repository.'),
  url: z.string().describe('Web URL of the created issue.'),
  state: z.string(),
});

export const createIssueTool = createTool({
  name: 'github_create_issue',
  title: 'Create a GitHub issue',
  description:
    'Opens a new issue on a repository the connected account can write to. This is visible ' +
    'to everyone with repository access — confirm the title and body with the user first.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement with POST /repos/{owner}/{repo}/issues.
  execute: async () => {
    throw new NotImplementedError('github_create_issue');
  },
});
