import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const isoDateTime = z.string().datetime({ offset: true });

const inputSchema = z
  .object({
    calendarId: z.string().default('primary'),
    summary: z.string().min(1).max(1024).describe('Event title.'),
    start: isoDateTime.describe('Event start, RFC 3339 with offset.'),
    end: isoDateTime.describe('Event end, RFC 3339 with offset. Must be after start.'),
    description: z.string().max(8192).optional(),
    location: z.string().max(1024).optional(),
    attendees: z
      .array(z.string().email())
      .max(100)
      .optional()
      .describe('Attendee email addresses. Each receives an invitation email.'),
  })
  .refine((value) => new Date(value.end) > new Date(value.start), {
    message: 'end must be after start.',
    path: ['end'],
  });

const outputSchema = z.object({
  id: z.string(),
  htmlLink: z.string(),
  status: z.string(),
});

export const createEventTool = createTool({
  name: 'calendar_create_event',
  title: 'Create a calendar event',
  description:
    'Creates an event on a Google Calendar. If attendees are supplied they are emailed an ' +
    'invitation immediately — confirm the guest list with the user before calling.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement with POST /calendars/{calendarId}/events.
  execute: async () => {
    throw new NotImplementedError('calendar_create_event');
  },
});
