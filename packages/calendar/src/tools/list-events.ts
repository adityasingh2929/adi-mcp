import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe('RFC 3339 timestamp with a UTC offset, e.g. 2026-07-31T09:00:00Z.');

const inputSchema = z.object({
  calendarId: z
    .string()
    .default('primary')
    .describe('Calendar to query. "primary" is the connected account\'s default calendar.'),
  timeMin: isoDateTime.describe('Start of the window (inclusive).'),
  timeMax: isoDateTime.describe('End of the window (exclusive).'),
  maxResults: z.number().int().min(1).max(250).default(50),
});

const outputSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      summary: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(z.string()).optional(),
      htmlLink: z.string().optional(),
    }),
  ),
});

export const listEventsTool = createTool({
  name: 'calendar_list_events',
  title: 'List calendar events',
  description:
    'Lists events on a Google Calendar within a time window. Read-only. Use this before ' +
    'creating an event to check for conflicts.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with GET /calendars/{calendarId}/events?singleEvents=true&orderBy=startTime.
  execute: async () => {
    throw new NotImplementedError('calendar_list_events');
  },
});
