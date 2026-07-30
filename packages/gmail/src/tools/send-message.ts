import { z } from 'zod';
import { NotImplementedError, createTool } from '@adi-mcp/core';

const emailAddress = z.string().email('Must be a valid email address.');

const inputSchema = z.object({
  to: z.array(emailAddress).min(1).max(100).describe('Primary recipients.'),
  cc: z.array(emailAddress).max(100).optional(),
  bcc: z.array(emailAddress).max(100).optional(),
  subject: z.string().min(1).max(998).describe('Subject line (RFC 5322 caps header lines at 998).'),
  body: z.string().min(1).describe('Plain-text message body.'),
  replyToMessageId: z
    .string()
    .optional()
    .describe("If set, sends as a reply within that message's thread."),
});

const outputSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

export const sendMessageTool = createTool({
  name: 'gmail_send_message',
  title: 'Send a Gmail message',
  description:
    'Sends an email from the connected mailbox. Delivery is immediate and cannot be recalled — ' +
    'always show the user the full recipient list, subject, and body and get explicit ' +
    'confirmation before calling.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement by building an RFC 5322 message, base64url-encoding it, and POSTing
  // to /users/me/messages/send.
  execute: async () => {
    throw new NotImplementedError('gmail_send_message');
  },
});
