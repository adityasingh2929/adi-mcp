import type { Env } from '@adi-mcp/shared';
import { ProviderRegistry, type Provider } from '@adi-mcp/core';
import type { CredentialStore, OAuth2CredentialProvider } from '@adi-mcp/auth';

import { xProvider, createXCredentialProvider } from '@adi-mcp/x';
import { linkedinProvider, createLinkedInCredentialProvider } from '@adi-mcp/linkedin';
import { githubProvider, createGithubCredentialProvider } from '@adi-mcp/github';
import { gmailProvider, createGmailCredentialProvider } from '@adi-mcp/gmail';
import { calendarProvider, createCalendarCredentialProvider } from '@adi-mcp/calendar';
import { notionProvider, createNotionCredentialProvider } from '@adi-mcp/notion';
import { obsidianProvider } from '@adi-mcp/obsidian';
import { postgresProvider } from '@adi-mcp/postgres';
import { supabaseProvider } from '@adi-mcp/supabase';
import { stripeProvider } from '@adi-mcp/stripe';
import { resendProvider } from '@adi-mcp/resend';
import { filesystemProvider } from '@adi-mcp/filesystem';
import { browserProvider } from '@adi-mcp/browser';

import { createSystemProvider } from './system-provider.js';

/**
 * Every provider this server exposes. Workers bundles statically, so this list is the one
 * place a new integration has to be registered — see docs/ADDING_PROVIDERS.md.
 */
const PROVIDERS: readonly Provider[] = [
  xProvider,
  linkedinProvider,
  githubProvider,
  gmailProvider,
  calendarProvider,
  notionProvider,
  obsidianProvider,
  postgresProvider,
  supabaseProvider,
  stripeProvider,
  resendProvider,
  filesystemProvider,
  browserProvider,
];

export type OAuthProviderFactory = (env: Env, store: CredentialStore) => OAuth2CredentialProvider;

/**
 * OAuth-capable providers, keyed by id. Drives the generic /providers/:id/connect and
 * /callback routes so no provider has to define its own HTTP handlers.
 */
const OAUTH_PROVIDER_FACTORIES: Readonly<Record<string, OAuthProviderFactory>> = {
  x: createXCredentialProvider,
  linkedin: createLinkedInCredentialProvider,
  github: createGithubCredentialProvider,
  gmail: createGmailCredentialProvider,
  calendar: createCalendarCredentialProvider,
  notion: createNotionCredentialProvider,
};

export function getOAuthProviderFactory(providerId: string): OAuthProviderFactory | undefined {
  return OAUTH_PROVIDER_FACTORIES[providerId];
}

/**
 * Builds the registry for a request. The system provider is registered last and reads the
 * registry lazily so it can report on every other provider, including itself.
 */
export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.registerAll(PROVIDERS);
  registry.register(createSystemProvider(() => registry));
  return registry;
}
