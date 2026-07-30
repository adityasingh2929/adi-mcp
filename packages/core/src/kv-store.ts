export interface KvPutOptions {
  /** Seconds until the key expires. */
  readonly expirationTtl?: number;
}

/** Minimal key-value abstraction so the rest of the framework never imports KVNamespace directly. */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KvPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Lists keys under a prefix. Not paginated — fine for this platform's low key volumes. */
  list(prefix: string): Promise<string[]>;
}

/** Adapter over a real Cloudflare Workers KV namespace. */
export class CloudflareKvStore implements KvStore {
  constructor(private readonly namespace: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.namespace.get(key);
  }

  async put(key: string, value: string, options?: KvPutOptions): Promise<void> {
    await this.namespace.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    await this.namespace.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const result = await this.namespace.list({ prefix });
    return result.keys.map((k) => k.name);
  }
}

interface InMemoryEntry {
  readonly value: string;
  readonly expiresAt: number | null;
}

/** In-memory KvStore for local dev and unit tests. Not persisted, not shared across isolates. */
export class InMemoryKvStore implements KvStore {
  private readonly store = new Map<string, InMemoryEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: KvPutOptions): Promise<void> {
    const expiresAt = options?.expirationTtl ? this.now() + options.expirationTtl * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const now = this.now();
    const keys: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (entry.expiresAt !== null && entry.expiresAt <= now) continue;
      keys.push(key);
    }
    return keys.sort();
  }
}
