import { z } from 'zod';
import { createTool } from '@adi-mcp/core';
import { XClient } from '../client.js';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(512)
    .describe(
      'X search query. Supports operators like `from:handle`, `#hashtag`, `-is:retweet`, ' +
        'and quoted phrases. Example: `from:anthropicai -is:retweet`.',
    ),
  maxResults: z
    .number()
    .int()
    .min(10, 'X requires at least 10 results per page.')
    .max(100)
    .default(10)
    .describe('How many posts to return (10-100).'),
});

const outputSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      authorId: z.string().optional(),
      createdAt: z.string().optional(),
      url: z.string(),
    }),
  ),
  resultCount: z.number().int(),
});

interface SearchResponse {
  readonly data?: readonly {
    readonly id: string;
    readonly text: string;
    readonly author_id?: string;
    readonly created_at?: string;
  }[];
  readonly meta?: { readonly result_count?: number };
}

export const searchPostsTool = createTool({
  name: 'x_search_recent_posts',
  title: 'Search recent X posts',
  description:
    'Searches posts from the last 7 days (the window the standard X API exposes). Returns ' +
    'post text, author id, and timestamp. Read-only — never publishes anything.',
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  execute: async (input, ctx) => {
    const response = await new XClient(ctx).request<SearchResponse>('/tweets/search/recent', {
      query: {
        query: input.query,
        max_results: String(input.maxResults),
        'tweet.fields': 'created_at,author_id',
      },
    });

    const posts = (response.data ?? []).map((post) => ({
      id: post.id,
      text: post.text,
      ...(post.author_id ? { authorId: post.author_id } : {}),
      ...(post.created_at ? { createdAt: post.created_at } : {}),
      url: `https://x.com/i/web/status/${post.id}`,
    }));

    return { posts, resultCount: response.meta?.result_count ?? posts.length };
  },
});
