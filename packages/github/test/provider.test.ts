import { describe, expect, it } from 'vitest';
import { InMemoryKvStore, NotImplementedError, createLogger } from '@adi-mcp/core';
import type { ExecutionContext } from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import type { Env } from '@adi-mcp/shared';
import {
  githubProvider,
  buildGithubOAuthConfig,
  createGithubCredentialProvider,
} from '../src/index.js';

const TEST_ENV = {
  GITHUB_CLIENT_ID: 'gh-client',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  GITHUB_REDIRECT_URI: 'https://worker.test/providers/github/callback',
} as Env;

const ctx: ExecutionContext = {
  userId: 'user-1',
  env: TEST_ENV,
  kv: new InMemoryKvStore(),
  logger: createLogger({ level: 'error' }),
  requestId: 'req-test',
};

describe('githubProvider', () => {
  it('declares its id and OAuth credential requirement', () => {
    expect(githubProvider.id).toBe('github');
    expect(githubProvider.credential.kind).toBe('oauth2');
    expect(githubProvider.credential.scopes).toContain('repo');
  });

  it('exposes provider-prefixed tools with substantive descriptions', () => {
    expect(githubProvider.tools.map((tool) => tool.name).sort()).toEqual([
      'github_create_issue',
      'github_list_repos',
    ]);
    for (const tool of githubProvider.tools) {
      expect(tool.name.startsWith('github_')).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('every tool reports NotImplementedError rather than crashing', async () => {
    for (const tool of githubProvider.tools) {
      await expect(tool.execute({}, ctx)).rejects.toThrow(NotImplementedError);
    }
  });
});

describe('github_list_repos schema', () => {
  const tool = githubProvider.tools.find((t) => t.name === 'github_list_repos')!;

  it('applies defaults', () => {
    expect(tool.inputSchema.parse({})).toEqual({
      visibility: 'all',
      sort: 'updated',
      perPage: 30,
    });
  });

  it('rejects an unknown visibility', () => {
    expect(tool.inputSchema.safeParse({ visibility: 'secret' }).success).toBe(false);
  });

  it('rejects perPage above 100', () => {
    expect(tool.inputSchema.safeParse({ perPage: 101 }).success).toBe(false);
  });

  it('is annotated read-only', () => {
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('github_create_issue schema', () => {
  const tool = githubProvider.tools.find((t) => t.name === 'github_create_issue')!;

  it('requires owner, repo, and title', () => {
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(tool.inputSchema.safeParse({ owner: 'a', repo: 'b', title: 'Bug report' }).success).toBe(
      true,
    );
  });

  it('rejects an empty title', () => {
    expect(tool.inputSchema.safeParse({ owner: 'a', repo: 'b', title: '' }).success).toBe(false);
  });

  it('is annotated as a non-read-only write', () => {
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });
});

describe('GitHub OAuth configuration', () => {
  it('targets GitHub endpoints without PKCE', () => {
    const config = buildGithubOAuthConfig(TEST_ENV);
    expect(config.authorizationEndpoint).toBe('https://github.com/login/oauth/authorize');
    // GitHub OAuth Apps do not support PKCE.
    expect(config.usePkce).toBe(false);
    expect(config.tokenAuthMethod).toBe('body');
  });

  it('produces a credential provider bound to the github id', () => {
    const provider = createGithubCredentialProvider(
      TEST_ENV,
      new CredentialStore(new InMemoryKvStore()),
    );
    expect(provider.providerId).toBe('github');
  });
});
