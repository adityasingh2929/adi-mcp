import { z } from 'zod';
import { ValidationError, createTool } from '@adi-mcp/core';
import { XClient } from '../client.js';

/** X's hard limit for a standard (non-Premium) post. */
const MAX_POST_LENGTH = 280;

const inputSchema = z.object({
  text: z
    .string()
    .min(1, 'Post text cannot be empty.')
    .max(MAX_POST_LENGTH, `Post text cannot exceed ${MAX_POST_LENGTH} characters.`)
    .describe('The text of the post. Maximum 280 characters.'),
  replyToPostId: z
    .string()
    .regex(/^\d+$/, 'Post ids are numeric strings.')
    .optional()
    .describe('If set, publishes this post as a reply to the given post id.'),
});

const outputSchema = z.object({
  id: z.string().describe('The id of the newly created post.'),
  text: z.string().describe('The text as stored by X.'),
  url: z.string().describe('Direct link to the published post.'),
});

interface CreatePostResponse {
  readonly data?: { readonly id: string; readonly text: string };
}

export const postTweetTool = createTool({
  name: 'x_post_tweet',
  title: 'Post to X',
  description:
    "Publishes a new post to X (formerly Twitter) on the authenticated user's behalf. " +
    'Text is limited to 280 characters. Optionally posts as a reply to an existing post. ' +
    'This action is public and immediate — confirm the exact wording with the user first.',
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  execute: async (input, ctx) => {
    // Count by code points: emoji and other astral characters are one character to X but
    // two UTF-16 units to `String.length`, so a naive length check rejects valid posts.
    const codePointLength = [...input.text].length;
    if (codePointLength > MAX_POST_LENGTH) {
      throw new ValidationError(
        `Post is ${codePointLength} characters; the limit is ${MAX_POST_LENGTH}.`,
      );
    }

    const response = await new XClient(ctx).request<CreatePostResponse>('/tweets', {
      method: 'POST',
      body: {
        text: input.text,
        ...(input.replyToPostId ? { reply: { in_reply_to_tweet_id: input.replyToPostId } } : {}),
      },
    });

    if (!response.data) {
      throw new ValidationError('X accepted the request but returned no post data.');
    }

    return {
      id: response.data.id,
      text: response.data.text,
      url: `https://x.com/i/web/status/${response.data.id}`,
    };
  },
});
