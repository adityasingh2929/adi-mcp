import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '../src/kv-store.js';

describe('InMemoryKvStore', () => {
  it('returns null for a missing key', async () => {
    const kv = new InMemoryKvStore();
    expect(await kv.get('missing')).toBeNull();
  });

  it('round-trips a put/get', async () => {
    const kv = new InMemoryKvStore();
    await kv.put('key', 'value');
    expect(await kv.get('key')).toBe('value');
  });

  it('deletes a key', async () => {
    const kv = new InMemoryKvStore();
    await kv.put('key', 'value');
    await kv.delete('key');
    expect(await kv.get('key')).toBeNull();
  });

  it('expires a key after expirationTtl elapses', async () => {
    let now = 1_000_000;
    const kv = new InMemoryKvStore(() => now);

    await kv.put('key', 'value', { expirationTtl: 10 });
    expect(await kv.get('key')).toBe('value');

    now += 11_000;
    expect(await kv.get('key')).toBeNull();
  });

  it('list() returns only non-expired keys under a prefix, sorted', async () => {
    let now = 0;
    const kv = new InMemoryKvStore(() => now);

    await kv.put('cred:x:1', 'a');
    await kv.put('cred:x:2', 'b', { expirationTtl: 5 });
    await kv.put('cred:linkedin:1', 'c');
    await kv.put('other:1', 'd');

    now += 6_000;

    expect(await kv.list('cred:x:')).toEqual(['cred:x:1']);
    expect(await kv.list('cred:')).toEqual(['cred:linkedin:1', 'cred:x:1']);
  });
});
