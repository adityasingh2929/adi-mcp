import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import type { Env } from '@adi-mcp/shared';
import {
  notionProvider,
  buildNotionOAuthConfig,
  createNotionCredentialProvider,
} from '../src/index.js';

const TEST_ENV = {
  NOTION_CLIENT_ID: 'notion-client',
  NOTION_CLIENT_SECRET: 'notion-secret',
  NOTION_REDIRECT_URI: 'https://worker.test/providers/notion/callback',
} as Env;

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: {} as Env,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('notionProvider', () => {
  it('declares its id and credential kind', () => {
    expect(notionProvider.id).toBe('notion');
    expect(notionProvider.credential.kind).toBe('oauth2');
    expect(notionProvider.credential.description.length).toBeGreaterThan(20);
  });

  it('exposes provider-prefixed tools with documented schemas', () => {
    expect(notionProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'notion_create_page',
      'notion_search',
    ]);
    for (const tool of notionProvider.tools) {
      expect(tool.name.startsWith('notion_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('reports NotImplementedError from every tool rather than crashing', async () => {
    for (const tool of notionProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });

  it('names the tool in its NotImplementedError so the gap is actionable', async () => {
    for (const tool of notionProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(tool.name);
    }
  });
});

describe('Notion OAuth configuration', () => {
  it('targets Notion endpoints with Basic client auth and no PKCE', () => {
    const config = buildNotionOAuthConfig(TEST_ENV);
    expect(config.authorizationEndpoint).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(config.tokenEndpoint).toBe('https://api.notion.com/v1/oauth/token');
    expect(config.usePkce).toBe(false);
    expect(config.tokenAuthMethod).toBe('basic');
  });

  it('requests no scopes, because Notion grants capabilities per integration', () => {
    expect(buildNotionOAuthConfig(TEST_ENV).scopes).toEqual([]);
    expect(buildNotionOAuthConfig(TEST_ENV).extraAuthorizationParams).toEqual({ owner: 'user' });
  });

  it('omits the client secret when none is configured', () => {
    expect(buildNotionOAuthConfig({} as Env).clientSecret).toBeUndefined();
  });

  it('produces a credential provider bound to the notion id', () => {
    const provider = createNotionCredentialProvider(
      TEST_ENV,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('notion');
    expect(provider.kind).toBe('oauth2');
  });
});
