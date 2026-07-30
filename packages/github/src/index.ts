import type { Provider } from '@adi-mcp/core';
import { GITHUB_PROVIDER_ID, GITHUB_SCOPES } from './config.js';
import { listReposTool } from './tools/list-repos.js';
import { createIssueTool } from './tools/create-issue.js';

export {
  GITHUB_PROVIDER_ID,
  GITHUB_API_BASE_URL,
  GITHUB_SCOPES,
  buildGithubOAuthConfig,
  createGithubCredentialProvider,
} from './config.js';

export const githubProvider: Provider = {
  id: GITHUB_PROVIDER_ID,
  displayName: 'GitHub',
  description:
    'Repository and issue operations against the GitHub REST API. Scaffold — tool schemas ' +
    'and OAuth wiring are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'oauth2',
    description:
      'OAuth 2.0 (Authorization Code). Requires GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and ' +
      'GITHUB_REDIRECT_URI. Connect at /providers/github/connect.',
    scopes: GITHUB_SCOPES,
  },
  tools: [listReposTool, createIssueTool],
};
