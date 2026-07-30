import type { Env } from '@adi-mcp/shared';

/**
 * Minimal in-memory stand-in for a Workers KV namespace, so the app can be exercised with
 * plain `app.fetch(...)` instead of booting the workerd runtime.
 */
export function createFakeKvNamespace(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    list: ({ prefix }: { prefix?: string } = {}) =>
      Promise.resolve({
        keys: [...store.keys()]
          .filter((key) => !prefix || key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      }),
  } as unknown as KVNamespace;
}

export const TEST_BEARER_TOKEN = 'test-bearer-token';

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ADI_MCP_KV: createFakeKvNamespace(),
    LOG_LEVEL: 'error',
    AUTH_STRATEGY: 'bearer',
    MCP_BEARER_TOKEN: TEST_BEARER_TOKEN,
    CORS_ALLOWED_ORIGINS: 'https://claude.ai',
    ...overrides,
  };
}

/** Builds a JSON-RPC request against /mcp with the headers the Streamable HTTP transport expects. */
export function mcpRequest(body: unknown, token: string | null = TEST_BEARER_TOKEN): Request {
  return new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
};

/** Reads a JSON-RPC result from either a plain JSON body or an SSE-framed response. */
export async function readJsonRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.includes('data:')) return JSON.parse(text) as Record<string, unknown>;

  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse((dataLine ?? '').slice('data:'.length).trim()) as Record<string, unknown>;
}
