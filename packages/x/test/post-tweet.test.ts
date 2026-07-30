import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthRequiredError,
  RateLimitError,
  UpstreamApiError,
  ValidationError,
} from '@adi-mcp/core';
import { postTweetTool } from '../src/tools/post-tweet.js';
import {
  jsonResponse,
  makeConnectedContext,
  makeDisconnectedContext,
  requestInit,
  requestUrl,
  stubFetch,
} from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('x_post_tweet schema', () => {
  it('rejects empty text', () => {
    expect(postTweetTool.inputSchema.safeParse({ text: '' }).success).toBe(false);
  });

  it('rejects text over 280 characters', () => {
    expect(postTweetTool.inputSchema.safeParse({ text: 'a'.repeat(281) }).success).toBe(false);
  });

  it('accepts text at exactly 280 characters', () => {
    expect(postTweetTool.inputSchema.safeParse({ text: 'a'.repeat(280) }).success).toBe(true);
  });

  it('rejects a non-numeric replyToPostId', () => {
    const result = postTweetTool.inputSchema.safeParse({ text: 'hi', replyToPostId: 'abc' });
    expect(result.success).toBe(false);
  });

  it('is annotated as a non-destructive, world-facing write', () => {
    expect(postTweetTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });
});

describe('x_post_tweet execution', () => {
  it('posts and returns the created post with a canonical URL', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ data: { id: '1234567890', text: 'hello world' } }, 201),
    );
    const ctx = await makeConnectedContext();

    const result = await postTweetTool.execute({ text: 'hello world' }, ctx);

    expect(result).toEqual({
      id: '1234567890',
      text: 'hello world',
      url: 'https://x.com/i/web/status/1234567890',
    });
    expect(requestUrl(fetchMock).pathname).toBe('/2/tweets');
    expect(requestInit(fetchMock).method).toBe('POST');
  });

  it('sends the bearer token from the stored credential', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { id: '1', text: 'x' } }, 201));

    await postTweetTool.execute({ text: 'x' }, await makeConnectedContext());

    expect(requestInit(fetchMock).headers?.authorization).toBe('Bearer test-access-token');
  });

  it('includes the reply reference when replyToPostId is given', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { id: '2', text: 'reply' } }, 201));

    await postTweetTool.execute(
      { text: 'reply', replyToPostId: '999' },
      await makeConnectedContext(),
    );

    const body = JSON.parse(requestInit(fetchMock).body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({ text: 'reply', reply: { in_reply_to_tweet_id: '999' } });
  });

  it('omits the reply reference when replyToPostId is absent', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { id: '3', text: 'solo' } }, 201));

    await postTweetTool.execute({ text: 'solo' }, await makeConnectedContext());

    const body = JSON.parse(requestInit(fetchMock).body ?? '{}') as Record<string, unknown>;
    expect(body).not.toHaveProperty('reply');
  });

  it('counts emoji as single characters rather than UTF-16 units', async () => {
    stubFetch(jsonResponse({ data: { id: '4', text: 'ok' } }, 201));
    // 200 emoji = 200 code points but 400 UTF-16 units. A naive length check would reject it.
    const text = '🎉'.repeat(200);

    await expect(
      postTweetTool.execute({ text }, await makeConnectedContext()),
    ).resolves.toBeDefined();
  });

  it('rejects text whose code-point length exceeds the limit', async () => {
    stubFetch(jsonResponse({ data: { id: '5', text: 'ok' } }, 201));

    await expect(
      postTweetTool.execute({ text: '🎉'.repeat(281) }, await makeConnectedContext()),
    ).rejects.toThrow(ValidationError);
  });

  it('throws AuthRequiredError when X is not connected', async () => {
    stubFetch(jsonResponse({}));

    await expect(postTweetTool.execute({ text: 'hi' }, makeDisconnectedContext())).rejects.toThrow(
      AuthRequiredError,
    );
  });

  it('translates a 403 into UpstreamApiError with the API detail', async () => {
    stubFetch(jsonResponse({ detail: 'You are not permitted to create a Post.' }, 403));

    await expect(
      postTweetTool.execute({ text: 'hi' }, await makeConnectedContext()),
    ).rejects.toThrow(/not permitted to create a Post/);
  });

  it('translates a 429 into RateLimitError with a retry hint', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 120;
    stubFetch(jsonResponse({}, 429, { 'x-rate-limit-reset': String(resetAt) }));

    const error = await postTweetTool
      .execute({ text: 'hi' }, await makeConnectedContext())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThan(100);
  });

  it('throws when X returns 200 with no post data', async () => {
    stubFetch(jsonResponse({}));

    await expect(
      postTweetTool.execute({ text: 'hi' }, await makeConnectedContext()),
    ).rejects.toThrow(ValidationError);
  });

  it('surfaces a non-JSON error body as UpstreamApiError', async () => {
    stubFetch(new Response('upstream exploded', { status: 500 }));

    await expect(
      postTweetTool.execute({ text: 'hi' }, await makeConnectedContext()),
    ).rejects.toThrow(UpstreamApiError);
  });
});
