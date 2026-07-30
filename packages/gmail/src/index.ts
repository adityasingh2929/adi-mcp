import type { Provider } from '@adi-mcp/core';
import { GMAIL_PROVIDER_ID, GMAIL_SCOPES } from './config.js';
import { searchMessagesTool } from './tools/search-messages.js';
import { sendMessageTool } from './tools/send-message.js';

export {
  GMAIL_PROVIDER_ID,
  GMAIL_API_BASE_URL,
  GMAIL_SCOPES,
  buildGmailOAuthConfig,
  createGmailCredentialProvider,
} from './config.js';

export const gmailProvider: Provider = {
  id: GMAIL_PROVIDER_ID,
  displayName: 'Gmail',
  description:
    'Search and send mail through the Gmail API. Scaffold — tool schemas and OAuth wiring ' +
    'are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'oauth2',
    description:
      'Google OAuth 2.0. Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ' +
      'GOOGLE_REDIRECT_URI, with the Gmail API enabled on the Cloud project. ' +
      'Connect at /providers/gmail/connect.',
    scopes: GMAIL_SCOPES,
  },
  tools: [searchMessagesTool, sendMessageTool],
};
