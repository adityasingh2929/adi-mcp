import { describe, expect, it } from 'vitest';
import {
  AuthRequiredError,
  McpToolError,
  NotImplementedError,
  RateLimitError,
  UpstreamApiError,
  ValidationError,
  toToolResult,
} from '../src/errors.js';

describe('error hierarchy', () => {
  it('McpToolError defaults to TOOL_ERROR code', () => {
    const error = new McpToolError('boom');
    expect(error.code).toBe('TOOL_ERROR');
    expect(error.name).toBe('McpToolError');
    expect(error).toBeInstanceOf(Error);
  });

  it('NotImplementedError mentions the tool name and NOT_IMPLEMENTED code', () => {
    const error = new NotImplementedError('github_create_issue');
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.message).toContain('github_create_issue');
  });

  it('AuthRequiredError mentions the connect route', () => {
    const error = new AuthRequiredError('notion');
    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.message).toContain('/providers/notion/connect');
  });

  it('ValidationError carries VALIDATION_ERROR code', () => {
    expect(new ValidationError('bad input').code).toBe('VALIDATION_ERROR');
  });

  it('RateLimitError exposes retryAfterSeconds', () => {
    const error = new RateLimitError(42);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.message).toContain('42s');
  });

  it('UpstreamApiError exposes status and provider', () => {
    const error = new UpstreamApiError('github', 503, 'Service Unavailable');
    expect(error.code).toBe('UPSTREAM_ERROR');
    expect(error.status).toBe(503);
    expect(error.provider).toBe('github');
    expect(error.message).toContain('503');
  });
});

describe('toToolResult', () => {
  it('formats McpToolError subclasses with their code', () => {
    const result = toToolResult(new NotImplementedError('x_post_tweet'));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      '[NOT_IMPLEMENTED] Tool "x_post_tweet" is a scaffold and has not been implemented yet. ' +
        'Fill in its client.ts / tools/*.ts logic to enable it — see docs/ADDING_PROVIDERS.md.',
    );
  });

  it('formats a plain Error as INTERNAL_ERROR', () => {
    const result = toToolResult(new Error('kaboom'));
    expect(result.content[0]?.text).toBe('[INTERNAL_ERROR] kaboom');
  });

  it('formats a non-Error throw as an unknown error', () => {
    const result = toToolResult('some string thrown');
    expect(result.content[0]?.text).toBe('[INTERNAL_ERROR] An unknown error occurred.');
  });
});
