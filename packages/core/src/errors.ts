/** Base class for every error a tool handler is expected to throw. Never lets the process crash. */
export class McpToolError extends Error {
  readonly code: string;

  constructor(message: string, code = 'TOOL_ERROR') {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
  }
}

/** Thrown by scaffold providers whose `execute()` has not been implemented yet. */
export class NotImplementedError extends McpToolError {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" is a scaffold and has not been implemented yet. ` +
        `Fill in its client.ts / tools/*.ts logic to enable it — see docs/ADDING_PROVIDERS.md.`,
      'NOT_IMPLEMENTED',
    );
    this.name = 'NotImplementedError';
  }
}

/** Thrown when a tool needs provider credentials that haven't been connected yet. */
export class AuthRequiredError extends McpToolError {
  constructor(providerId: string) {
    super(
      `No credentials found for provider "${providerId}". Connect it first via /providers/${providerId}/connect.`,
      'AUTH_REQUIRED',
    );
    this.name = 'AuthRequiredError';
  }
}

/** Thrown for input that fails validation beyond what the Zod schema alone can express. */
export class ValidationError extends McpToolError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/** Thrown by the rate limiter when a caller has exceeded its quota. */
export class RateLimitError extends McpToolError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`, 'RATE_LIMITED');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Thrown when a downstream provider API returns an error response. */
export class UpstreamApiError extends McpToolError {
  readonly status: number;
  readonly provider: string;

  constructor(provider: string, status: number, message: string) {
    super(`${provider} API error (${status}): ${message}`, 'UPSTREAM_ERROR');
    this.name = 'UpstreamApiError';
    this.status = status;
    this.provider = provider;
  }
}

export interface ToolErrorResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError: true;
}

/**
 * Converts any thrown value into a well-formed MCP tool error result instead of letting it
 * propagate and crash the request. Every tool invocation in apps/server routes through this.
 */
export function toToolResult(error: unknown): ToolErrorResult {
  if (error instanceof McpToolError) {
    return { content: [{ type: 'text', text: `[${error.code}] ${error.message}` }], isError: true };
  }
  if (error instanceof Error) {
    return {
      content: [{ type: 'text', text: `[INTERNAL_ERROR] ${error.message}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: '[INTERNAL_ERROR] An unknown error occurred.' }],
    isError: true,
  };
}
