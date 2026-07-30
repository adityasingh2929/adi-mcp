import type { Env } from '@adi-mcp/shared';
import { AuthRequiredError } from '@adi-mcp/core';
import type { CredentialContext, CredentialProvider, ProviderCredential } from '../types.js';

/**
 * Reads a long-lived secret (API key or bearer token) straight out of the Worker env.
 * Used by providers like Stripe and Resend that authenticate with a single static key —
 * no KV round-trip and no refresh cycle needed.
 */
export class StaticCredentialProvider implements CredentialProvider {
  constructor(
    readonly providerId: string,
    readonly kind: 'api-key' | 'bearer',
    private readonly envKey: keyof Env,
  ) {}

  private read(env: Env): string | undefined {
    const value = env[this.envKey];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  async getCredential(ctx: CredentialContext): Promise<ProviderCredential> {
    const accessToken = this.read(ctx.env);
    if (!accessToken) {
      throw new AuthRequiredError(this.providerId);
    }
    return { kind: this.kind, accessToken };
  }

  async isConnected(ctx: CredentialContext): Promise<boolean> {
    return this.read(ctx.env) !== undefined;
  }
}
