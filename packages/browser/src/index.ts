import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';
import { StaticCredentialProvider } from '@adi-mcp/auth';

export const BROWSER_PROVIDER_ID = 'browser';

export const browserCredentialProvider = new StaticCredentialProvider(
  BROWSER_PROVIDER_ID,
  'api-key',
  'BROWSER_API_KEY',
);

/**
 * Only http/https are allowed. Blocking other schemes at the schema level keeps `file://`
 * and similar out of a headless browser that runs inside our infrastructure.
 */
const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), {
    message: 'Only http and https URLs are allowed.',
  });

const fetchPageTool = createTool({
  name: 'browser_fetch_page',
  title: 'Fetch a rendered page',
  description:
    'Loads a URL in a headless browser, waits for it to render, and returns the visible text ' +
    'and title. Use this instead of a plain HTTP fetch when the page needs JavaScript to ' +
    'produce its content. Read-only — does not click, type, or submit anything.',
  inputSchema: z.object({
    url: httpUrl.describe('Absolute http/https URL to load.'),
    waitForSelector: z
      .string()
      .max(500)
      .optional()
      .describe('CSS selector to wait for before capturing, for slow-rendering pages.'),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  }),
  outputSchema: z.object({
    url: z.string().describe('Final URL after any redirects.'),
    title: z.string().optional(),
    text: z.string(),
    statusCode: z.number().int().optional(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  // SCAFFOLD: implement against Cloudflare Browser Rendering (the @cloudflare/puppeteer
  // binding) or a remote CDP endpoint at BROWSER_REMOTE_ENDPOINT.
  execute: async () => {
    throw new NotImplementedError('browser_fetch_page');
  },
});

const screenshotTool = createTool({
  name: 'browser_screenshot',
  title: 'Screenshot a page',
  description:
    'Loads a URL in a headless browser and returns a PNG screenshot as a base64 string. ' +
    'Read-only.',
  inputSchema: z.object({
    url: httpUrl,
    fullPage: z.boolean().default(false).describe('Capture the whole scrollable page.'),
    width: z.number().int().min(320).max(3840).default(1280),
    height: z.number().int().min(240).max(2160).default(800),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  }),
  outputSchema: z.object({
    url: z.string(),
    mimeType: z.literal('image/png'),
    base64: z.string(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  // SCAFFOLD: implement with the same browser backend as browser_fetch_page.
  execute: async () => {
    throw new NotImplementedError('browser_screenshot');
  },
});

export const browserProvider: Provider = {
  id: BROWSER_PROVIDER_ID,
  displayName: 'Browser',
  description:
    'Headless browser automation: render pages and capture screenshots. Scaffold — tool ' +
    'schemas and credential wiring are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'api-key',
    description:
      'Either a Cloudflare Browser Rendering binding, or BROWSER_REMOTE_ENDPOINT plus a ' +
      'BROWSER_API_KEY Worker secret for a hosted CDP provider.',
  },
  tools: [fetchPageTool, screenshotTool],
};
