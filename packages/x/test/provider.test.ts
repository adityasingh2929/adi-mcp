import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import { xProvider } from '../src/index.js';
import { buildXOAuthConfig, createXCredentialProvider } from '../src/config.js';
import { TEST_ENV, makeConnectedContext } from './helpers.js';

describe('xProvider definition', () => {
  it('declares its id, OAuth requirement, and scopes', () => {
    expect(xProvider.id).toBe('x');
    expect(xProvider.credential.kind).toBe('oauth2');
    expect(xProvider.credential.scopes).toContain('tweet.write');
    // offline.access is what makes X issue a refresh token — without it connections expire.
    expect(xProvider.credential.scopes).toContain('offline.access');
  });

  it('exposes exactly the expected tools, all prefixed with the provider id', () => {
    expect(xProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'x_delete_post',
      'x_get_me',
      'x_post_tweet',
      'x_search_recent_posts',
    ]);
    for (const tool of xProvider.tools) {
      expect(tool.name.startsWith('x_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('exposes the compose-post prompt', () => {
    expect(xProvider.prompts?.map((prompt) => prompt.name)).toEqual(['x_compose_post']);
  });

  it('builds a prompt that withholds publishing until approved', async () => {
    const prompt = xProvider.prompts![0]!;
    const messages = await prompt.build(
      { topic: 'shipping a new MCP server', tone: 'technical' },
      await makeConnectedContext(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.text).toContain('shipping a new MCP server');
    expect(messages[0]?.content.text).toContain('technical');
    expect(messages[0]?.content.text).toMatch(/approve/i);
  });

  it('omits the tone line when no tone is supplied', async () => {
    const prompt = xProvider.prompts![0]!;
    const messages = await prompt.build({ topic: 'a topic' }, await makeConnectedContext());

    expect(messages[0]?.content.text).not.toContain('Tone:');
  });
});

describe('X OAuth configuration', () => {
  it("targets X's authorization and token endpoints with PKCE and Basic auth", () => {
    const config = buildXOAuthConfig(TEST_ENV);

    expect(config.authorizationEndpoint).toBe('https://x.com/i/oauth2/authorize');
    expect(config.tokenEndpoint).toBe('https://api.x.com/2/oauth2/token');
    expect(config.usePkce).toBe(true);
    expect(config.tokenAuthMethod).toBe('basic');
    expect(config.clientId).toBe('test-client-id');
  });

  it('produces a credential provider bound to the x provider id', () => {
    const provider = createXCredentialProvider(
      TEST_ENV,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('x');
    expect(provider.kind).toBe('oauth2');
  });
});
