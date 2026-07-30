import { z } from 'zod';
import { createPrompt, type Provider } from '@adi-mcp/core';
import { X_PROVIDER_ID, X_SCOPES } from './config.js';
import { postTweetTool } from './tools/post-tweet.js';
import { getMeTool } from './tools/get-me.js';
import { searchPostsTool } from './tools/search-posts.js';
import { deleteTweetTool } from './tools/delete-tweet.js';

export { X_PROVIDER_ID, X_SCOPES, buildXOAuthConfig, createXCredentialProvider } from './config.js';
export { XClient, type XRequestOptions } from './client.js';

const composePostPrompt = createPrompt({
  name: 'x_compose_post',
  title: 'Compose an X post',
  description:
    'Drafts a post for X from a topic, constrained to the 280-character limit, and asks for ' +
    'approval before anything is published.',
  argsSchema: {
    topic: z.string().describe('What the post should be about'),
    tone: z
      .string()
      .optional()
      .describe('Optional tone, e.g. "technical", "casual", "announcement"'),
  },
  build: async (args) => [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          `Draft a post for X about: ${args.topic}\n` +
          (args.tone ? `Tone: ${args.tone}\n` : '') +
          '\nConstraints:\n' +
          '- Maximum 280 characters, counted by code points (emoji count as one).\n' +
          '- No hashtag spam; at most one or two if they genuinely add reach.\n' +
          '- Lead with the substance, not a hook cliché.\n' +
          '\nShow me the draft and the exact character count. Do not call `x_post_tweet` ' +
          'until I explicitly approve the wording.',
      },
    },
  ],
});

export const xProvider: Provider = {
  id: X_PROVIDER_ID,
  displayName: 'X',
  description:
    'Post to X, read the authenticated profile, search recent posts, and delete posts. ' +
    'Uses OAuth 2.0 with PKCE against the X API v2.',
  credential: {
    kind: 'oauth2',
    description:
      'OAuth 2.0 (Authorization Code + PKCE). Requires X_CLIENT_ID, X_CLIENT_SECRET, and ' +
      'X_REDIRECT_URI. Connect at /providers/x/connect.',
    scopes: X_SCOPES,
  },
  tools: [postTweetTool, getMeTool, searchPostsTool, deleteTweetTool],
  prompts: [composePostPrompt],
};
