import type { Provider } from '@adi-mcp/core';
import { NOTION_PROVIDER_ID } from './config.js';
import { searchTool } from './tools/search.js';
import { createPageTool } from './tools/create-page.js';

export {
  NOTION_PROVIDER_ID,
  NOTION_API_BASE_URL,
  NOTION_API_VERSION,
  buildNotionOAuthConfig,
  createNotionCredentialProvider,
} from './config.js';

export const notionProvider: Provider = {
  id: NOTION_PROVIDER_ID,
  displayName: 'Notion',
  description:
    'Search Notion and create pages. Scaffold — tool schemas and OAuth wiring are complete; ' +
    'tool execution is not yet implemented.',
  credential: {
    kind: 'oauth2',
    description:
      'Notion public integration OAuth 2.0. Requires NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, ' +
      "and NOTION_REDIRECT_URI. Access is granted per page/database in Notion's UI rather " +
      'than via OAuth scopes. Connect at /providers/notion/connect.',
  },
  tools: [searchTool, createPageTool],
};
