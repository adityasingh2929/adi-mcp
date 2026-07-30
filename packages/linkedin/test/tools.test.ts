import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, RateLimitError, UpstreamApiError } from '@adi-mcp/core';
import { getProfileTool } from '../src/tools/get-profile.js';
import { sharePostTool } from '../src/tools/share-post.js';
import {
  jsonResponse,
  makeConnectedContext,
  makeDisconnectedContext,
  requestInit,
  requestUrl,
  stubFetchSequence,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const USERINFO = {
  sub: 'abc123',
  name: 'Adi Singh',
  given_name: 'Adi',
  family_name: 'Singh',
  email: 'adi@example.com',
  picture: 'https://media.linkedin.com/photo.jpg',
};

describe('linkedin_get_profile', () => {
  it('maps the userinfo payload and derives the author URN', async () => {
    stubFetchSequence(jsonResponse(USERINFO));

    const result = await getProfileTool.execute({}, await makeConnectedContext());

    expect(result).toEqual({
      memberId: 'abc123',
      name: 'Adi Singh',
      givenName: 'Adi',
      familyName: 'Singh',
      email: 'adi@example.com',
      pictureUrl: 'https://media.linkedin.com/photo.jpg',
      authorUrn: 'urn:li:person:abc123',
    });
    expect(getProfileTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it('omits optional fields LinkedIn does not return', async () => {
    stubFetchSequence(jsonResponse({ sub: 'xyz' }));

    const result = await getProfileTool.execute({}, await makeConnectedContext());

    expect(result).toEqual({ memberId: 'xyz', authorUrn: 'urn:li:person:xyz' });
  });

  it('calls the OpenID userinfo endpoint with the Restli protocol header', async () => {
    const fetchMock = stubFetchSequence(jsonResponse(USERINFO));

    await getProfileTool.execute({}, await makeConnectedContext());

    expect(requestUrl(fetchMock).pathname).toBe('/v2/userinfo');
    expect(requestInit(fetchMock).headers?.['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(requestInit(fetchMock).headers?.authorization).toBe('Bearer test-access-token');
  });

  it('throws a scope-specific error when sub is missing', async () => {
    stubFetchSequence(jsonResponse({}));

    await expect(getProfileTool.execute({}, await makeConnectedContext())).rejects.toThrow(
      /openid.*profile.*scopes/,
    );
  });

  it('throws AuthRequiredError when LinkedIn is not connected', async () => {
    stubFetchSequence(jsonResponse(USERINFO));

    await expect(getProfileTool.execute({}, makeDisconnectedContext())).rejects.toThrow(
      AuthRequiredError,
    );
  });

  it('is annotated read-only', () => {
    expect(getProfileTool.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('linkedin_share_post schema', () => {
  it('rejects empty text', () => {
    expect(sharePostTool.inputSchema.safeParse({ text: '' }).success).toBe(false);
  });

  it('rejects text over 3000 characters', () => {
    expect(sharePostTool.inputSchema.safeParse({ text: 'a'.repeat(3001) }).success).toBe(false);
  });

  it('defaults visibility to PUBLIC', () => {
    expect(sharePostTool.inputSchema.parse({ text: 'hi' }).visibility).toBe('PUBLIC');
  });

  it('rejects an unknown visibility value', () => {
    expect(sharePostTool.inputSchema.safeParse({ text: 'hi', visibility: 'SECRET' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed linkUrl', () => {
    expect(sharePostTool.inputSchema.safeParse({ text: 'hi', linkUrl: 'not-a-url' }).success).toBe(
      false,
    );
  });
});

describe('linkedin_share_post execution', () => {
  it('resolves the author then creates the post', async () => {
    const fetchMock = stubFetchSequence(
      jsonResponse(USERINFO),
      jsonResponse({}, 201, { 'x-restli-id': 'urn:li:share:999' }),
    );

    const result = await sharePostTool.execute(
      { text: 'hello linkedin', visibility: 'PUBLIC' },
      await makeConnectedContext(),
    );

    expect(result).toEqual({
      id: 'urn:li:share:999',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:999',
      visibility: 'PUBLIC',
    });

    expect(requestUrl(fetchMock, 0).pathname).toBe('/v2/userinfo');
    expect(requestUrl(fetchMock, 1).pathname).toBe('/rest/posts');
    expect(requestInit(fetchMock, 1).method).toBe('POST');
  });

  it('sends the LinkedIn-Version header on the versioned posts endpoint only', async () => {
    const fetchMock = stubFetchSequence(
      jsonResponse(USERINFO),
      jsonResponse({ id: 'urn:li:share:1' }, 201),
    );

    await sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext());

    expect(requestInit(fetchMock, 0).headers?.['LinkedIn-Version']).toBeUndefined();
    expect(requestInit(fetchMock, 1).headers?.['LinkedIn-Version']).toBeTruthy();
  });

  it('builds the UGC post body with the author URN and commentary', async () => {
    const fetchMock = stubFetchSequence(
      jsonResponse(USERINFO),
      jsonResponse({ id: 'urn:li:share:1' }, 201),
    );

    await sharePostTool.execute(
      { text: 'body text', visibility: 'CONNECTIONS' },
      await makeConnectedContext(),
    );

    const body = JSON.parse(requestInit(fetchMock, 1).body ?? '{}') as Record<string, unknown>;
    expect(body.author).toBe('urn:li:person:abc123');
    expect(body.commentary).toBe('body text');
    expect(body.visibility).toBe('CONNECTIONS');
    expect(body.lifecycleState).toBe('PUBLISHED');
    expect(body).not.toHaveProperty('content');
  });

  it('attaches an article card when linkUrl is supplied', async () => {
    const fetchMock = stubFetchSequence(
      jsonResponse(USERINFO),
      jsonResponse({ id: 'urn:li:share:1' }, 201),
    );

    await sharePostTool.execute(
      {
        text: 'check this out',
        visibility: 'PUBLIC',
        linkUrl: 'https://example.com/post',
        linkTitle: 'A Post',
      },
      await makeConnectedContext(),
    );

    const body = JSON.parse(requestInit(fetchMock, 1).body ?? '{}') as {
      content?: { article?: { source?: string; title?: string } };
    };
    expect(body.content?.article).toEqual({ source: 'https://example.com/post', title: 'A Post' });
  });

  it('throws when the author id cannot be resolved', async () => {
    stubFetchSequence(jsonResponse({}));

    await expect(
      sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext()),
    ).rejects.toThrow(/member id/);
  });

  it('throws when LinkedIn returns no post id', async () => {
    stubFetchSequence(jsonResponse(USERINFO), jsonResponse({}, 201));

    await expect(
      sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext()),
    ).rejects.toThrow(/did not return a post id/);
  });

  it('translates an upstream error into UpstreamApiError with its message', async () => {
    stubFetchSequence(
      jsonResponse(USERINFO),
      jsonResponse({ message: 'Not enough permissions' }, 403),
    );

    await expect(
      sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext()),
    ).rejects.toThrow(/Not enough permissions/);
  });

  it('translates a 429 into RateLimitError', async () => {
    stubFetchSequence(jsonResponse(USERINFO), jsonResponse({}, 429));

    await expect(
      sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext()),
    ).rejects.toThrow(RateLimitError);
  });

  it('surfaces a non-JSON error body', async () => {
    stubFetchSequence(jsonResponse(USERINFO), new Response('gateway down', { status: 502 }));

    await expect(
      sharePostTool.execute({ text: 'x', visibility: 'PUBLIC' }, await makeConnectedContext()),
    ).rejects.toThrow(UpstreamApiError);
  });
});
