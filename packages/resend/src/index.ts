import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';
import { StaticCredentialProvider } from '@adi-mcp/auth';

export const RESEND_PROVIDER_ID = 'resend';
export const RESEND_API_BASE_URL = 'https://api.resend.com';

export const resendCredentialProvider = new StaticCredentialProvider(
  RESEND_PROVIDER_ID,
  'api-key',
  'RESEND_API_KEY',
);

const emailAddress = z.string().email('Must be a valid email address.');

const sendEmailTool = createTool({
  name: 'resend_send_email',
  title: 'Send an email via Resend',
  description:
    'Sends a transactional email through Resend. The `from` address must be on a domain ' +
    'already verified in the Resend dashboard. Delivery is immediate and irreversible — ' +
    'show the user the full recipient list, subject, and body before calling.',
  inputSchema: z
    .object({
      from: emailAddress.describe('Sender address on a Resend-verified domain.'),
      to: z.array(emailAddress).min(1).max(50).describe('Recipient addresses.'),
      subject: z.string().min(1).max(998),
      html: z.string().max(500_000).optional().describe('HTML body. Provide this or `text`.'),
      text: z.string().max(500_000).optional().describe('Plain-text body. Provide this or `html`.'),
      replyTo: emailAddress.optional(),
    })
    .refine((value) => Boolean(value.html ?? value.text), {
      message: 'Provide at least one of `html` or `text`.',
      path: ['text'],
    }),
  outputSchema: z.object({ id: z.string().describe('Resend message id.') }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement with POST /emails, Bearer auth using the api-key credential.
  execute: async () => {
    throw new NotImplementedError('resend_send_email');
  },
});

const getEmailStatusTool = createTool({
  name: 'resend_get_email_status',
  title: 'Get Resend email status',
  description:
    'Looks up the delivery status of a previously sent email by its Resend message id. ' +
    'Read-only.',
  inputSchema: z.object({
    emailId: z.string().min(1).describe('The id returned by resend_send_email.'),
  }),
  outputSchema: z.object({
    id: z.string(),
    status: z.string().describe('e.g. "delivered", "bounced", "queued".'),
    to: z.array(z.string()),
    subject: z.string().optional(),
    createdAt: z.string().optional(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with GET /emails/{emailId}.
  execute: async () => {
    throw new NotImplementedError('resend_get_email_status');
  },
});

export const resendProvider: Provider = {
  id: RESEND_PROVIDER_ID,
  displayName: 'Resend',
  description:
    'Send transactional email and check delivery status via Resend. Scaffold — tool schemas ' +
    'and credential wiring are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'api-key',
    description:
      'API key from the Resend dashboard, set as the RESEND_API_KEY Worker secret. The ' +
      'sending domain must be verified in Resend before any send will succeed.',
  },
  tools: [sendEmailTool, getEmailStatusTool],
};
