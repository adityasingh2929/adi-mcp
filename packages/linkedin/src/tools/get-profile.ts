import { z } from 'zod';
import { UpstreamApiError, createTool } from '@adi-mcp/core';
import { LinkedInClient } from '../client.js';

const outputSchema = z.object({
  memberId: z.string().describe('OpenID `sub` claim — the stable member identifier.'),
  name: z.string().optional(),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  email: z.string().optional(),
  pictureUrl: z.string().optional(),
  authorUrn: z.string().describe('URN to use as the author when publishing posts.'),
});

interface UserInfoResponse {
  readonly sub?: string;
  readonly name?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly email?: string;
  readonly picture?: string;
}

export const getProfileTool = createTool({
  name: 'linkedin_get_profile',
  title: 'Get LinkedIn profile',
  description:
    'Returns the profile of the LinkedIn member connected to this server, including the ' +
    'member URN needed to author posts. Read-only.',
  inputSchema: z.object({}),
  outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  execute: async (_input, ctx) => {
    const profile = await new LinkedInClient(ctx).request<UserInfoResponse>('/v2/userinfo');

    if (!profile.sub) {
      throw new UpstreamApiError(
        'linkedin',
        502,
        'LinkedIn returned no member id. Ensure the app has the `openid` and `profile` scopes.',
      );
    }

    return {
      memberId: profile.sub,
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.given_name ? { givenName: profile.given_name } : {}),
      ...(profile.family_name ? { familyName: profile.family_name } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.picture ? { pictureUrl: profile.picture } : {}),
      authorUrn: `urn:li:person:${profile.sub}`,
    };
  },
});
