import { describe, expect, it } from 'vitest';
import { AuthRequiredError, InMemoryKvStore, createLogger } from '@adi-mcp/core';
import type { Env } from '@adi-mcp/shared';
import { StaticCredentialProvider } from '../src/credentials/static.js';
import type { CredentialContext } from '../src/types.js';

function makeContext(env: Partial<Env>): CredentialContext {
  return {
    userId: 'user-1',
    env: env as Env,
    kv: new InMemoryKvStore(),
    logger: createLogger({ level: 'error' }),
  };
}

describe('StaticCredentialProvider', () => {
  const provider = new StaticCredentialProvider('stripe', 'api-key', 'STRIPE_API_KEY');

  it('returns the configured secret', async () => {
    const credential = await provider.getCredential(makeContext({ STRIPE_API_KEY: 'sk_test_123' }));
    expect(credential).toEqual({ kind: 'api-key', accessToken: 'sk_test_123' });
  });

  it('throws AuthRequiredError when the secret is not set', async () => {
    await expect(provider.getCredential(makeContext({}))).rejects.toThrow(AuthRequiredError);
  });

  it('treats an empty-string secret as unset', async () => {
    await expect(provider.getCredential(makeContext({ STRIPE_API_KEY: '' }))).rejects.toThrow(
      AuthRequiredError,
    );
    expect(await provider.isConnected(makeContext({ STRIPE_API_KEY: '' }))).toBe(false);
  });

  it('isConnected reflects whether the secret is present', async () => {
    expect(await provider.isConnected(makeContext({ STRIPE_API_KEY: 'sk_test' }))).toBe(true);
    expect(await provider.isConnected(makeContext({}))).toBe(false);
  });

  it('exposes providerId and kind', () => {
    expect(provider.providerId).toBe('stripe');
    expect(provider.kind).toBe('api-key');
  });
});
