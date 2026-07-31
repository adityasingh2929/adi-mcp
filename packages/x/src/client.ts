import {
  RateLimitError,
  UpstreamApiError,
  globalFetch,
  type ExecutionContext,
} from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import { X_API_BASE_URL, X_PROVIDER_ID, createXCredentialProvider } from './config.js';

interface XErrorBody {
  readonly title?: string;
  readonly detail?: string;
  readonly errors?: readonly { readonly message?: string }[];
}

export interface XRequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

/**
 * Thin authenticated wrapper over the X API v2. Credential resolution (including refresh)
 * is delegated to {@link OAuth2CredentialProvider}, so this client only deals with
 * request shaping and error translation.
 */
export class XClient {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  async request<TResponse>(path: string, options: XRequestOptions = {}): Promise<TResponse> {
    const store = new CredentialStore(this.ctx.kv, this.ctx.env.CREDENTIAL_ENCRYPTION_KEY);
    const credentials = createXCredentialProvider(this.ctx.env, store);
    const credential = await credentials.getCredential({
      userId: this.ctx.userId,
      env: this.ctx.env,
      kv: this.ctx.kv,
      logger: this.ctx.logger,
    });

    const url = new URL(`${X_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await this.fetchImpl(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    if (response.status === 429) {
      const resetAt = Number.parseInt(response.headers.get('x-rate-limit-reset') ?? '', 10);
      const retryAfter = Number.isFinite(resetAt)
        ? Math.max(1, resetAt - Math.floor(Date.now() / 1000))
        : 60;
      throw new RateLimitError(retryAfter);
    }

    if (!response.ok) {
      throw new UpstreamApiError(X_PROVIDER_ID, response.status, await describeError(response));
    }

    // DELETE and some POSTs can return an empty body; callers treat that as an empty object.
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as TResponse;
  }
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as XErrorBody;
    return (
      parsed.detail ??
      parsed.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ') ??
      parsed.title ??
      text
    );
  } catch {
    return text || response.statusText;
  }
}
