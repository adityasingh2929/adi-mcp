import { z } from 'zod';
import { createPrompt, type Provider } from '@adi-mcp/core';
import { LINKEDIN_PROVIDER_ID, LINKEDIN_SCOPES } from './config.js';
import { getProfileTool } from './tools/get-profile.js';
import { sharePostTool } from './tools/share-post.js';

export {
  LINKEDIN_PROVIDER_ID,
  LINKEDIN_SCOPES,
  DEFAULT_LINKEDIN_API_VERSION,
  linkedInApiVersion,
  buildLinkedInOAuthConfig,
  createLinkedInCredentialProvider,
} from './config.js';
export { LinkedInClient, type LinkedInRequestOptions } from './client.js';

const composePostPrompt = createPrompt({
  name: 'linkedin_compose_post',
  title: 'Compose a LinkedIn post',
  description:
    'Drafts a LinkedIn post from a topic in a professional register, and asks for approval ' +
    'before anything is published.',
  argsSchema: {
    topic: z.string().describe('What the post should be about'),
    audience: z
      .string()
      .optional()
      .describe('Optional target audience, e.g. "engineering leaders", "recruiters"'),
  },
  build: async (args) => [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          `Draft a LinkedIn post about: ${args.topic}\n` +
          (args.audience ? `Audience: ${args.audience}\n` : '') +
          '\nConstraints:\n' +
          '- Maximum 3000 characters, but aim for under 1300 so it fits before "see more".\n' +
          '- Open with the substance, not "I am thrilled to announce".\n' +
          '- Short paragraphs; no engagement-bait questions at the end.\n' +
          '\nShow me the draft. Do not call `linkedin_share_post` until I explicitly approve it.',
      },
    },
  ],
});

export const linkedinProvider: Provider = {
  id: LINKEDIN_PROVIDER_ID,
  displayName: 'LinkedIn',
  description:
    'Read the connected LinkedIn profile and publish posts to its feed, optionally with a ' +
    'link attachment. Uses OAuth 2.0 against the LinkedIn REST API.',
  credential: {
    kind: 'oauth2',
    description:
      'OAuth 2.0 (Authorization Code). Requires LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, ' +
      'and LINKEDIN_REDIRECT_URI, plus the "Sign In with LinkedIn using OpenID Connect" and ' +
      '"Share on LinkedIn" products enabled on the app. Connect at /providers/linkedin/connect.',
    scopes: LINKEDIN_SCOPES,
  },
  tools: [getProfileTool, sharePostTool],
  prompts: [composePostPrompt],
};
