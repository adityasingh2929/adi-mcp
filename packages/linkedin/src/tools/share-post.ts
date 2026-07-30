import { z } from 'zod';
import { UpstreamApiError, createTool } from '@adi-mcp/core';
import { LinkedInClient } from '../client.js';

/** LinkedIn's documented maximum for a UGC post's commentary. */
const MAX_COMMENTARY_LENGTH = 3000;

const inputSchema = z.object({
  text: z
    .string()
    .min(1, 'Post text cannot be empty.')
    .max(MAX_COMMENTARY_LENGTH, `Post text cannot exceed ${MAX_COMMENTARY_LENGTH} characters.`)
    .describe('The body of the post. Maximum 3000 characters.'),
  visibility: z
    .enum(['PUBLIC', 'CONNECTIONS'])
    .default('PUBLIC')
    .describe('PUBLIC is visible to anyone; CONNECTIONS restricts it to first-degree contacts.'),
  linkUrl: z
    .string()
    .url('linkUrl must be a valid absolute URL.')
    .optional()
    .describe('Optional URL to attach as an article card.'),
  linkTitle: z
    .string()
    .max(200)
    .optional()
    .describe('Title for the attached link. Ignored unless linkUrl is set.'),
});

const outputSchema = z.object({
  id: z.string().describe('URN of the created post.'),
  url: z.string().describe('Direct link to the published post.'),
  visibility: z.string(),
});

interface UserInfoResponse {
  readonly sub?: string;
}

interface CreatePostResponse {
  readonly id?: string;
}

export const sharePostTool = createTool({
  name: 'linkedin_share_post',
  title: 'Share a post on LinkedIn',
  description:
    "Publishes a post to the connected LinkedIn member's feed, optionally with a link " +
    'attachment. This is public and immediate — confirm the exact wording with the user ' +
    'before calling.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: async (input, ctx) => {
    const client = new LinkedInClient(ctx);

    // The author URN is required in the post body and is not derivable from the token,
    // so it has to be looked up first.
    const profile = await client.request<UserInfoResponse>('/v2/userinfo');
    if (!profile.sub) {
      throw new UpstreamApiError(
        'linkedin',
        502,
        'Could not resolve the LinkedIn member id needed to author the post.',
      );
    }

    const response = await client.request<CreatePostResponse>('/rest/posts', {
      method: 'POST',
      versioned: true,
      body: {
        author: `urn:li:person:${profile.sub}`,
        commentary: input.text,
        visibility: input.visibility,
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(input.linkUrl
          ? {
              content: {
                article: {
                  source: input.linkUrl,
                  ...(input.linkTitle ? { title: input.linkTitle } : {}),
                },
              },
            }
          : {}),
      },
    });

    if (!response.id) {
      throw new UpstreamApiError('linkedin', 502, 'LinkedIn did not return a post id.');
    }

    return {
      id: response.id,
      url: `https://www.linkedin.com/feed/update/${response.id}`,
      visibility: input.visibility,
    };
  },
});
