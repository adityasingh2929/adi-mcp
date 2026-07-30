import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '@adi-mcp/core';
import { CredentialStore } from '../src/credential-store.js';
import type { ProviderCredential } from '../src/types.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

const credential: ProviderCredential = {
  kind: 'oauth2',
  accessToken: 'access-123',
  refreshToken: 'refresh-456',
  expiresAt: 1_700_000_000_000,
  scopes: ['tweet.read'],
};

describe('CredentialStore', () => {
  it('round-trips a credential without encryption', async () => {
    const store = new CredentialStore(new InMemoryKvStore());
    await store.save('x', 'user-1', credential);
    expect(await store.load('x', 'user-1')).toEqual(credential);
  });

  it('round-trips a credential with encryption and does not store it in plaintext', async () => {
    const kv = new InMemoryKvStore();
    const store = new CredentialStore(kv, KEY);

    await store.save('x', 'user-1', credential);

    const rawStored = await kv.get('cred:x:user-1');
    expect(rawStored).not.toBeNull();
    expect(rawStored).not.toContain('access-123');
    expect(await store.load('x', 'user-1')).toEqual(credential);
  });

  it('returns null for an unconnected provider', async () => {
    const store = new CredentialStore(new InMemoryKvStore());
    expect(await store.load('notion', 'user-1')).toBeNull();
  });

  it('deletes a credential', async () => {
    const store = new CredentialStore(new InMemoryKvStore());
    await store.save('x', 'user-1', credential);
    await store.delete('x', 'user-1');
    expect(await store.load('x', 'user-1')).toBeNull();
  });

  it('namespaces credentials per provider and per user', async () => {
    const store = new CredentialStore(new InMemoryKvStore());
    await store.save('x', 'user-1', credential);

    expect(await store.load('linkedin', 'user-1')).toBeNull();
    expect(await store.load('x', 'user-2')).toBeNull();
  });

  it('lists only the providers a given user has connected', async () => {
    const store = new CredentialStore(new InMemoryKvStore());
    await store.save('x', 'user-1', credential);
    await store.save('linkedin', 'user-1', credential);
    await store.save('notion', 'user-2', credential);

    expect((await store.listConnectedProviders('user-1')).sort()).toEqual(['linkedin', 'x']);
    expect(await store.listConnectedProviders('user-2')).toEqual(['notion']);
  });
});
