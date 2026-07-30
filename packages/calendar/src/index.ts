import type { Provider } from '@adi-mcp/core';
import { CALENDAR_PROVIDER_ID, CALENDAR_SCOPES } from './config.js';
import { listEventsTool } from './tools/list-events.js';
import { createEventTool } from './tools/create-event.js';

export {
  CALENDAR_PROVIDER_ID,
  CALENDAR_API_BASE_URL,
  CALENDAR_SCOPES,
  buildCalendarOAuthConfig,
  createCalendarCredentialProvider,
} from './config.js';

export const calendarProvider: Provider = {
  id: CALENDAR_PROVIDER_ID,
  displayName: 'Google Calendar',
  description:
    'Read and create events on Google Calendar. Scaffold — tool schemas and OAuth wiring ' +
    'are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'oauth2',
    description:
      'Google OAuth 2.0. Requires GOOGLE_CALENDAR_CLIENT_ID/SECRET (falls back to the ' +
      'GOOGLE_* pair) and GOOGLE_CALENDAR_REDIRECT_URI, with the Calendar API enabled. ' +
      'Connect at /providers/calendar/connect.',
    scopes: CALENDAR_SCOPES,
  },
  tools: [listEventsTool, createEventTool],
};
