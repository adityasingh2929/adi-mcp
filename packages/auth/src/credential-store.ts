import { KV_KEY_PREFIXES } from '@adi-mcp/shared';
import type { KvStore } from '@adi-mcp/core';
import { decryptString, encryptString } from './crypto.js';
import type { ProviderCredential } from './types.js';

/**
 * Persists provider credentials in KV, encrypted at rest when a
 * `CREDENTIAL_ENCRYPTION_KEY` is configured. Keys are namespaced
 * `cred:<providerId>:<userId>` so one provider can never read another's tokens.
 */
export class CredentialStore {
  constructor(
    private readonly kv: KvStore,
    private readonly encryptionKey?: string,
  ) {}

  private key(providerId: string, userId: string): string {
    return `${KV_KEY_PREFIXES.credential}:${providerId}:${userId}`;
  }

  async save(providerId: string, userId: string, credential: ProviderCredential): Promise<void> {
    const serialized = JSON.stringify(credential);
    const payload = this.encryptionKey
      ? await encryptString(serialized, this.encryptionKey)
      : serialized;
    await this.kv.put(this.key(providerId, userId), payload);
  }

  async load(providerId: string, userId: string): Promise<ProviderCredential | null> {
    const payload = await this.kv.get(this.key(providerId, userId));
    if (payload === null) return null;

    const serialized = this.encryptionKey
      ? await decryptString(payload, this.encryptionKey)
      : payload;
    return JSON.parse(serialized) as ProviderCredential;
  }

  async delete(providerId: string, userId: string): Promise<void> {
    await this.kv.delete(this.key(providerId, userId));
  }

  /** Lists the provider ids this user has connected. */
  async listConnectedProviders(userId: string): Promise<string[]> {
    const keys = await this.kv.list(`${KV_KEY_PREFIXES.credential}:`);
    const suffix = `:${userId}`;
    return keys
      .filter((key) => key.endsWith(suffix))
      .map((key) => key.slice(`${KV_KEY_PREFIXES.credential}:`.length, key.length - suffix.length))
      .filter((providerId) => providerId.length > 0 && !providerId.includes(':'));
  }
}
