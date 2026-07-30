import { z } from 'zod';
import {
  createPrompt,
  createResource,
  createTool,
  type Provider,
  type ProviderRegistry,
} from '@adi-mcp/core';
import { CredentialStore } from '@adi-mcp/auth';
import { SERVER_INFO } from './mcp-server.js';

/**
 * Built-in provider exposing the server's own state. Doubles as the reference example for
 * how resources and prompts are authored — see docs/RESOURCES_AND_PROMPTS.md.
 *
 * Takes the registry lazily (via a getter) because the registry is not fully populated until
 * every provider — including this one — has been registered.
 */
export function createSystemProvider(getRegistry: () => ProviderRegistry): Provider {
  return {
    id: 'system',
    displayName: 'System',
    description: 'Introspection over the Adi MCP server itself: providers, tools, and health.',
    credential: { kind: 'none', description: 'No credentials required.' },

    tools: [
      createTool({
        name: 'system_list_providers',
        title: 'List providers',
        description:
          'Lists every integration registered on this server, whether its credentials are ' +
          'connected for the current user, and how many tools it exposes. Call this first ' +
          'when unsure which provider owns a capability.',
        inputSchema: z.object({}),
        outputSchema: z.object({
          providers: z.array(
            z.object({
              id: z.string(),
              displayName: z.string(),
              description: z.string(),
              credentialKind: z.string(),
              connected: z.boolean(),
              toolCount: z.number().int(),
            }),
          ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        execute: async (_input, ctx) => {
          const store = new CredentialStore(ctx.kv, ctx.env.CREDENTIAL_ENCRYPTION_KEY);
          const connected = new Set(await store.listConnectedProviders(ctx.userId));

          return {
            providers: getRegistry()
              .getProviders()
              .map((provider) => ({
                id: provider.id,
                displayName: provider.displayName,
                description: provider.description,
                credentialKind: provider.credential.kind,
                connected: provider.credential.kind === 'none' || connected.has(provider.id),
                toolCount: provider.tools.length,
              })),
          };
        },
      }),
    ],

    resources: [
      createResource({
        uri: 'system://health',
        name: 'server-health',
        title: 'Server health',
        description: 'Current server version, uptime marker, and registered provider count.',
        mimeType: 'application/json',
        read: async (uri) => [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                status: 'ok',
                server: SERVER_INFO.name,
                version: SERVER_INFO.version,
                providerCount: getRegistry().getProviders().length,
                toolCount: getRegistry().getTools().length,
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      }),

      createResource({
        uri: 'system://providers/{providerId}',
        name: 'provider-detail',
        title: 'Provider detail',
        description:
          'Full detail for one provider: its credential requirement and every tool it ' +
          'exposes, with descriptions. URI template — substitute a provider id.',
        mimeType: 'application/json',
        isTemplate: true,
        read: async (uri) => {
          const providerId = uri.split('/').pop() ?? '';
          const provider = getRegistry().getProvider(providerId);

          if (!provider) {
            return [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ error: `Unknown provider "${providerId}".` }, null, 2),
              },
            ];
          }

          return [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  id: provider.id,
                  displayName: provider.displayName,
                  description: provider.description,
                  credential: provider.credential,
                  tools: provider.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    annotations: tool.annotations ?? {},
                  })),
                },
                null,
                2,
              ),
            },
          ];
        },
      }),
    ],

    prompts: [
      createPrompt({
        name: 'system_orient',
        title: 'Orient on this server',
        description:
          'Produces a briefing that asks the model to survey the available providers and ' +
          'propose how to accomplish a stated goal with them.',
        argsSchema: { goal: z.string().describe('What the user is trying to accomplish') },
        build: async (args) => [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `I want to: ${args.goal}\n\n` +
                'Call `system_list_providers` to see what integrations are available and ' +
                'which are connected. Then outline the specific tools you would use, in order, ' +
                'and flag any provider I still need to connect first.',
            },
          },
        ],
      }),
    ],
  };
}
