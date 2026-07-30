import { vi } from 'vitest';
import { InMemoryKvStore, createLogger, type ExecutionContext } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import type { Env } from '@adi-mcp/shared';

export const TEST_ENV: Env = {
  LINKEDIN_CLIENT_ID: 'test-client-id',
  LINKEDIN_CLIENT_SECRET: 'test-client-secret',
  LINKEDIN_REDIRECT_URI: 'https://worker.test/providers/linkedin/callback',
} as Env;

export async function makeConnectedContext(): Promise<ExecutionContext> {
  const kv = new InMemoryKvStore();
  await new CredentialStore(kv).save('linkedin', 'user-1', {
    kind: 'oauth2',
    accessToken: 'test-access-token',
  });

  return {
    userId: 'user-1',
    env: TEST_ENV,
    kv,
    logger: createLogger({ level: 'error' }),
    requestId: 'req-test',
  };
}

export function makeDisconnectedContext(): ExecutionContext {
  return {
    userId: 'user-1',
    env: TEST_ENV,
    kv: new InMemoryKvStore(),
    logger: createLogger({ level: 'error' }),
    requestId: 'req-test',
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Stubs global fetch with a queue of responses, one per successive call. */
export function stubFetchSequence(...responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function requestUrl(mock: ReturnType<typeof vi.fn>, callIndex = 0): URL {
  return new URL(String(mock.mock.calls[callIndex]?.[0]));
}

export function requestInit(
  mock: ReturnType<typeof vi.fn>,
  callIndex = 0,
): { method?: string; body?: string; headers?: Record<string, string> } {
  return (mock.mock.calls[callIndex]?.[1] ?? {}) as {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  };
}
