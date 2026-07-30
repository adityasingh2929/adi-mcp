import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamApiError } from '@adi-mcp/core';
import { getMeTool } from '../src/tools/get-me.js';
import { searchPostsTool } from '../src/tools/search-posts.js';
import { deleteTweetTool } from '../src/tools/delete-tweet.js';
import {
  jsonResponse,
  makeConnectedContext,
  requestInit,
  requestUrl,
  stubFetch,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('x_get_me', () => {
  it('maps the X payload onto the output schema', async () => {
    stubFetch(
      jsonResponse({
        data: {
          id: '111',
          username: 'adi',
          name: 'Adi',
          public_metrics: { followers_count: 42, following_count: 7, tweet_count: 100 },
        },
      }),
    );

    const result = await getMeTool.execute({}, await makeConnectedContext());

    expect(result).toEqual({
      id: '111',
      username: 'adi',
      name: 'Adi',
      followersCount: 42,
      followingCount: 7,
      postCount: 100,
    });
    expect(getMeTool.outputSchema?.safeParse(result).success).toBe(true);
  });

  it('requests public_metrics so counts are populated', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { id: '1', username: 'a', name: 'A' } }));

    await getMeTool.execute({}, await makeConnectedContext());

    expect(requestUrl(fetchMock).searchParams.get('user.fields')).toBe('public_metrics');
  });

  it('omits metric fields when X does not return them', async () => {
    stubFetch(jsonResponse({ data: { id: '1', username: 'a', name: 'A' } }));

    const result = await getMeTool.execute({}, await makeConnectedContext());

    expect(result).toEqual({ id: '1', username: 'a', name: 'A' });
  });

  it('throws when X returns no user data', async () => {
    stubFetch(jsonResponse({}));

    await expect(getMeTool.execute({}, await makeConnectedContext())).rejects.toThrow(
      UpstreamApiError,
    );
  });

  it('is annotated read-only', () => {
    expect(getMeTool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });
});

describe('x_search_recent_posts', () => {
  it("rejects maxResults below X's minimum of 10", () => {
    expect(searchPostsTool.inputSchema.safeParse({ query: 'a', maxResults: 5 }).success).toBe(
      false,
    );
  });

  it('rejects maxResults above 100', () => {
    expect(searchPostsTool.inputSchema.safeParse({ query: 'a', maxResults: 101 }).success).toBe(
      false,
    );
  });

  it('defaults maxResults to 10', () => {
    const parsed = searchPostsTool.inputSchema.parse({ query: 'a' });
    expect(parsed.maxResults).toBe(10);
  });

  it('maps results and derives canonical URLs', async () => {
    stubFetch(
      jsonResponse({
        data: [
          { id: '1', text: 'first', author_id: 'a1', created_at: '2026-07-01T00:00:00Z' },
          { id: '2', text: 'second' },
        ],
        meta: { result_count: 2 },
      }),
    );

    const result = await searchPostsTool.execute(
      { query: 'from:anthropicai', maxResults: 10 },
      await makeConnectedContext(),
    );

    expect(result.resultCount).toBe(2);
    expect(result.posts[0]).toEqual({
      id: '1',
      text: 'first',
      authorId: 'a1',
      createdAt: '2026-07-01T00:00:00Z',
      url: 'https://x.com/i/web/status/1',
    });
    expect(result.posts[1]).toEqual({
      id: '2',
      text: 'second',
      url: 'https://x.com/i/web/status/2',
    });
  });

  it('passes the query and field selection to the API', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: [] }));

    await searchPostsTool.execute(
      { query: '#typescript -is:retweet', maxResults: 50 },
      await makeConnectedContext(),
    );

    const url = requestUrl(fetchMock);
    expect(url.pathname).toBe('/2/tweets/search/recent');
    expect(url.searchParams.get('query')).toBe('#typescript -is:retweet');
    expect(url.searchParams.get('max_results')).toBe('50');
    expect(url.searchParams.get('tweet.fields')).toBe('created_at,author_id');
  });

  it('returns an empty result set when X returns no matches', async () => {
    stubFetch(jsonResponse({ meta: { result_count: 0 } }));

    const result = await searchPostsTool.execute(
      { query: 'nothing', maxResults: 10 },
      await makeConnectedContext(),
    );

    expect(result).toEqual({ posts: [], resultCount: 0 });
  });
});

describe('x_delete_post', () => {
  it('rejects a non-numeric post id', () => {
    expect(deleteTweetTool.inputSchema.safeParse({ postId: 'not-a-number' }).success).toBe(false);
  });

  it('issues a DELETE to the post resource', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { deleted: true } }));

    const result = await deleteTweetTool.execute({ postId: '555' }, await makeConnectedContext());

    expect(result).toEqual({ deleted: true, postId: '555' });
    expect(requestUrl(fetchMock).pathname).toBe('/2/tweets/555');
    expect(requestInit(fetchMock).method).toBe('DELETE');
  });

  it('treats an empty response body as a successful delete', async () => {
    stubFetch(new Response('', { status: 200 }));

    const result = await deleteTweetTool.execute({ postId: '556' }, await makeConnectedContext());

    expect(result.deleted).toBe(true);
  });

  it('is annotated as destructive', () => {
    expect(deleteTweetTool.annotations).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false,
    });
  });
});
