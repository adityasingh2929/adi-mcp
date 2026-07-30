import { z } from 'zod';
import { UpstreamApiError, createTool } from '@adi-mcp/core';
import { XClient } from '../client.js';

const outputSchema = z.object({
  id: z.string(),
  username: z.string().describe('Handle without the leading @.'),
  name: z.string().describe('Display name.'),
  followersCount: z.number().int().optional(),
  followingCount: z.number().int().optional(),
  postCount: z.number().int().optional(),
});

interface MeResponse {
  readonly data?: {
    readonly id: string;
    readonly username: string;
    readonly name: string;
    readonly public_metrics?: {
      readonly followers_count?: number;
      readonly following_count?: number;
      readonly tweet_count?: number;
    };
  };
}

export const getMeTool = createTool({
  name: 'x_get_me',
  title: 'Get authenticated X account',
  description:
    'Returns the profile of the X account currently connected to this server, including ' +
    'follower and post counts. Useful for confirming which account posts will publish from.',
  inputSchema: z.object({}),
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  execute: async (_input, ctx) => {
    const response = await new XClient(ctx).request<MeResponse>('/users/me', {
      query: { 'user.fields': 'public_metrics' },
    });

    if (!response.data) {
      throw new UpstreamApiError('x', 502, 'X returned no user data for the connected account.');
    }

    const metrics = response.data.public_metrics;
    return {
      id: response.data.id,
      username: response.data.username,
      name: response.data.name,
      ...(metrics?.followers_count !== undefined
        ? { followersCount: metrics.followers_count }
        : {}),
      ...(metrics?.following_count !== undefined
        ? { followingCount: metrics.following_count }
        : {}),
      ...(metrics?.tweet_count !== undefined ? { postCount: metrics.tweet_count } : {}),
    };
  },
});
