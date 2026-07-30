import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';
import { StaticCredentialProvider } from '@adi-mcp/auth';

export const STRIPE_PROVIDER_ID = 'stripe';
export const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';

export const stripeCredentialProvider = new StaticCredentialProvider(
  STRIPE_PROVIDER_ID,
  'api-key',
  'STRIPE_API_KEY',
);

const listCustomersTool = createTool({
  name: 'stripe_list_customers',
  title: 'List Stripe customers',
  description:
    'Lists customers on the connected Stripe account, optionally filtered by email. ' +
    'Read-only — never creates charges or modifies billing state.',
  inputSchema: z.object({
    email: z.string().email().optional().describe('Exact-match filter on customer email.'),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  outputSchema: z.object({
    customers: z.array(
      z.object({
        id: z.string(),
        email: z.string().optional(),
        name: z.string().optional(),
        created: z.number().int().describe('Unix timestamp.'),
        currency: z.string().optional(),
      }),
    ),
    hasMore: z.boolean(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  // SCAFFOLD: implement with GET /v1/customers using the api-key credential as Bearer auth.
  execute: async () => {
    throw new NotImplementedError('stripe_list_customers');
  },
});

const createPaymentLinkTool = createTool({
  name: 'stripe_create_payment_link',
  title: 'Create a Stripe payment link',
  description:
    'Creates a shareable Stripe payment link for an existing price. The link is immediately ' +
    'live and can accept real money — confirm the price id and quantity with the user first.',
  inputSchema: z.object({
    priceId: z.string().min(1).describe('Id of an existing Stripe Price object (price_...).'),
    quantity: z.number().int().min(1).max(999).default(1),
    afterCompletionUrl: z
      .string()
      .url()
      .optional()
      .describe('Where to redirect the buyer after a successful payment.'),
  }),
  outputSchema: z.object({
    id: z.string(),
    url: z.string(),
    active: z.boolean(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // SCAFFOLD: implement with POST /v1/payment_links (form-encoded, not JSON).
  execute: async () => {
    throw new NotImplementedError('stripe_create_payment_link');
  },
});

export const stripeProvider: Provider = {
  id: STRIPE_PROVIDER_ID,
  displayName: 'Stripe',
  description:
    'Read customers and create payment links via the Stripe API. Scaffold — tool schemas ' +
    'and credential wiring are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'api-key',
    description:
      'Secret API key from the Stripe dashboard, set as the STRIPE_API_KEY Worker secret. ' +
      'Use a restricted key scoped to only the resources these tools need.',
  },
  tools: [listCustomersTool, createPaymentLinkTool],
};
