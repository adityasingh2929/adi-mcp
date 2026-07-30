import { describe, expect, it } from 'vitest';
import { InMemoryKvStore } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import { linkedinProvider } from '../src/index.js';
import { buildLinkedInOAuthConfig, createLinkedInCredentialProvider } from '../src/config.js';
import { TEST_ENV, makeConnectedContext } from './helpers.js';

describe('linkedinProvider definition', () => {
  it('declares its id, OAuth requirement, and posting scope', () => {
    expect(linkedinProvider.id).toBe('linkedin');
    expect(linkedinProvider.credential.kind).toBe('oauth2');
    expect(linkedinProvider.credential.scopes).toContain('w_member_social');
    expect(linkedinProvider.credential.scopes).toContain('openid');
  });

  it('exposes exactly the expected tools, all provider-prefixed', () => {
    expect(linkedinProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'linkedin_get_profile',
      'linkedin_share_post',
    ]);
    for (const tool of linkedinProvider.tools) {
      expect(tool.name.startsWith('linkedin_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('builds a prompt that withholds publishing until approved', async () => {
    const prompt = linkedinProvider.prompts![0]!;
    const messages = await prompt.build(
      { topic: 'launching Adi MCP', audience: 'engineering leaders' },
      await makeConnectedContext(),
    );

    expect(messages[0]?.content.text).toContain('launching Adi MCP');
    expect(messages[0]?.content.text).toContain('engineering leaders');
    expect(messages[0]?.content.text).toMatch(/approve/i);
  });

  it('omits the audience line when none is supplied', async () => {
    const prompt = linkedinProvider.prompts![0]!;
    const messages = await prompt.build({ topic: 'a topic' }, await makeConnectedContext());

    expect(messages[0]?.content.text).not.toContain('Audience:');
  });
});

describe('LinkedIn OAuth configuration', () => {
  it('targets LinkedIn endpoints without PKCE and with body client auth', () => {
    const config = buildLinkedInOAuthConfig(TEST_ENV);

    expect(config.authorizationEndpoint).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(config.tokenEndpoint).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    // LinkedIn's token endpoint rejects PKCE parameters and expects credentials in the body.
    expect(config.usePkce).toBe(false);
    expect(config.tokenAuthMethod).toBe('body');
  });

  it('produces a credential provider bound to the linkedin provider id', () => {
    const provider = createLinkedInCredentialProvider(
      TEST_ENV,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('linkedin');
  });
});
