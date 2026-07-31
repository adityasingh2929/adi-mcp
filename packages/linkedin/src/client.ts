import {
  RateLimitError,
  UpstreamApiError,
  globalFetch,
  type ExecutionContext,
} from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import {
  LINKEDIN_API_BASE_URL,
  LINKEDIN_API_VERSION,
  LINKEDIN_PROVIDER_ID,
  createLinkedInCredentialProvider,
} from './config.js';

interface LinkedInErrorBody {
  readonly message?: string;
  readonly serviceErrorCode?: number;
}

export interface LinkedInRequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  /** Versioned REST endpoints (/rest/*) need the LinkedIn-Version header; /v2/* do not. */
  readonly versioned?: boolean;
}

/** Authenticated wrapper over the LinkedIn REST API. */
export class LinkedInClient {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  async request<TResponse>(path: string, options: LinkedInRequestOptions = {}): Promise<TResponse> {
    const store = new CredentialStore(this.ctx.kv, this.ctx.env.CREDENTIAL_ENCRYPTION_KEY);
    const credentials = createLinkedInCredentialProvider(this.ctx.env, store);
    const credential = await credentials.getCredential({
      userId: this.ctx.userId,
      env: this.ctx.env,
      kv: this.ctx.kv,
      logger: this.ctx.logger,
    });

    const url = new URL(`${LINKEDIN_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await this.fetchImpl(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
        // Opts into LinkedIn's modern protocol; without it the API returns legacy-encoded
        // payloads that don't match the documented JSON shapes.
        'X-Restli-Protocol-Version': '2.0.0',
        ...(options.versioned ? { 'LinkedIn-Version': LINKEDIN_API_VERSION } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    if (response.status === 429) {
      throw new RateLimitError(60);
    }

    if (!response.ok) {
      throw new UpstreamApiError(
        LINKEDIN_PROVIDER_ID,
        response.status,
        await describeError(response),
      );
    }

    // LinkedIn returns 201 with an empty body and an x-restli-id header on post creation.
    const text = await response.text();
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const restliId = response.headers.get('x-restli-id');

    return (restliId ? { ...parsed, id: parsed.id ?? restliId } : parsed) as TResponse;
  }
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as LinkedInErrorBody;
    return parsed.message ?? text;
  } catch {
    return text || response.statusText;
  }
}
