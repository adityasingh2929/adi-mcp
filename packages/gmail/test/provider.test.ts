import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import type { Env } from '@adi-mcp/shared';
import {
  gmailProvider,
  buildGmailOAuthConfig,
  createGmailCredentialProvider,
} from '../src/index.js';

const TEST_ENV = {
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_REDIRECT_URI: 'https://worker.test/providers/gmail/callback',
} as Env;

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('gmailProvider', () => {
  it('declares its id and credential kind', () => {
    expect(gmailProvider.id).toBe('gmail');
    expect(gmailProvider.credential.kind).toBe('oauth2');
    expect(gmailProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(gmailProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'gmail_search_messages',
      'gmail_send_message',
    ]);
    for (const tool of gmailProvider.tools) {
      expect(tool.name.startsWith('gmail_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of gmailProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of gmailProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('Gmail OAuth configuration', () => {
  it('targets Google endpoints with PKCE and body client auth', () => {
    const config = buildGmailOAuthConfig(TEST_ENV);
    expect(config.authorizationEndpoint).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(config.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
    expect(config.usePkce).toBe(true);
    expect(config.tokenAuthMethod).toBe('body');
    expect(config.redirectUri).toBe(TEST_ENV.GOOGLE_REDIRECT_URI);
  });

  it('forces offline access so a refresh token is actually issued', () => {
    // Google only returns a refresh token when both are set, and re-issues one on reconsent
    // only with prompt=consent. Without these the connection dies after ~1h.
    expect(buildGmailOAuthConfig(TEST_ENV).extraAuthorizationParams).toEqual({
      access_type: 'offline',
      prompt: 'consent',
    });
  });

  it('omits the client secret when none is configured', () => {
    expect(buildGmailOAuthConfig({} as Env).clientSecret).toBeUndefined();
  });

  it('produces a credential provider bound to the gmail id', () => {
    const provider = createGmailCredentialProvider(
      TEST_ENV,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('gmail');
    expect(provider.kind).toBe('oauth2');
  });
});
