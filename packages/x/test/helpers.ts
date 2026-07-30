import { vi } from 'vitest';
import { InMemoryKvStore, createLogger, type ExecutionContext } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import type { Env } from '@adi-mcp/shared';

export const TEST_ENV: Env = {
  X_CLIENT_ID: 'test-client-id',
  X_CLIENT_SECRET: 'test-client-secret',
  X_REDIRECT_URI: 'https://worker.test/providers/x/callback',
} as Env;

/** Builds an ExecutionContext with X already "connected" via a long-lived stored credential. */
export async function makeConnectedContext(): Promise<ExecutionContext> {
  const kv = new InMemoryKvStore();
  await new CredentialStore(kv).save('x', 'user-1', {
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

/** ExecutionContext with no stored credential — exercises the AuthRequiredError path. */
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

/** Installs a stub for global fetch and returns the mock for assertions. */
export function stubFetch(response: Response | (() => Response)) {
  const mock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(typeof response === 'function' ? response() : response),
    );
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
