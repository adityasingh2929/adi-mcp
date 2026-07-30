import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { INITIALIZE_REQUEST, makeEnv, mcpRequest, readJsonRpc } from './helpers.js';

const app = createApp();

/** Runs a single JSON-RPC call against /mcp and returns the parsed result payload. */
async function call(method: string, params: Record<string, unknown> = {}, id = 2) {
  const response = await app.fetch(mcpRequest({ jsonrpc: '2.0', id, method, params }), makeEnv());
  return { response, body: await readJsonRpc(response) };
}

describe('initialize', () => {
  it('returns server info and the advertised capabilities', async () => {
    const response = await app.fetch(mcpRequest(INITIALIZE_REQUEST), makeEnv());
    const body = await readJsonRpc(response);

    expect(response.status).toBe(200);
    const result = body.result as {
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
      instructions?: string;
    };

    expect(result.serverInfo.name).toBe('adi-mcp');
    expect(result.capabilities).toHaveProperty('tools');
    expect(result.capabilities).toHaveProperty('resources');
    expect(result.capabilities).toHaveProperty('prompts');
    expect(result.instructions).toContain('provider');
  });
});

describe('tools/list', () => {
  it('lists tools from every registered provider', async () => {
    const { body } = await call('tools/list');
    const result = body.result as { tools: { name: string; description: string }[] };

    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain('x_post_tweet');
    expect(names).toContain('linkedin_share_post');
    expect(names).toContain('github_list_repos');
    expect(names).toContain('stripe_list_customers');
    expect(names).toContain('system_list_providers');
    expect(names.length).toBeGreaterThanOrEqual(27);
  });

  it('exposes a JSON Schema and description for every tool', async () => {
    const { body } = await call('tools/list');
    const result = body.result as {
      tools: { name: string; description?: string; inputSchema: { type: string } }[];
    };

    for (const tool of result.tools) {
      expect(tool.description, `${tool.name} is missing a description`).toBeTruthy();
      expect(tool.inputSchema.type, `${tool.name} has a malformed input schema`).toBe('object');
    }
  });

  it('carries tool annotations through to the wire format', async () => {
    const { body } = await call('tools/list');
    const result = body.result as {
      tools: { name: string; annotations?: Record<string, boolean> }[];
    };

    const deletePost = result.tools.find((tool) => tool.name === 'x_delete_post');
    expect(deletePost?.annotations?.destructiveHint).toBe(true);

    const getMe = result.tools.find((tool) => tool.name === 'x_get_me');
    expect(getMe?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('tools/call', () => {
  it('returns a structured MCP error instead of crashing when a provider is not connected', async () => {
    const { response, body } = await call('tools/call', {
      name: 'x_get_me',
      arguments: {},
    });

    // The HTTP layer still succeeds — the failure is carried inside the tool result.
    expect(response.status).toBe(200);
    const result = body.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('AUTH_REQUIRED');
    expect(result.content[0]?.text).toContain('/providers/x/connect');
  });

  it('reports a scaffold tool as NOT_IMPLEMENTED rather than failing opaquely', async () => {
    const { body } = await call('tools/call', {
      name: 'github_list_repos',
      arguments: {},
    });

    const result = body.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('NOT_IMPLEMENTED');
    expect(result.content[0]?.text).toContain('github_list_repos');
  });

  it('rejects arguments that fail schema validation', async () => {
    const { body } = await call('tools/call', {
      name: 'x_post_tweet',
      arguments: { text: 'a'.repeat(500) },
    });

    const result = body.result as { isError?: boolean; content?: { text: string }[] };
    expect(result.isError).toBe(true);
  });

  it('executes a working tool and returns structured content', async () => {
    const { body } = await call('tools/call', {
      name: 'system_list_providers',
      arguments: {},
    });

    const result = body.result as {
      isError?: boolean;
      structuredContent: { providers: { id: string; connected: boolean }[] };
    };

    expect(result.isError).toBeFalsy();
    const ids = result.structuredContent.providers.map((provider) => provider.id);
    expect(ids).toContain('x');
    expect(ids).toContain('system');

    // Providers needing credentials report as unconnected until the user connects them.
    const x = result.structuredContent.providers.find((provider) => provider.id === 'x')!;
    expect(x.connected).toBe(false);
  });

  it('returns a JSON-RPC error for an unknown tool name', async () => {
    const { body } = await call('tools/call', { name: 'does_not_exist', arguments: {} });

    const hasRpcError = body.error !== undefined;
    const result = body.result as { isError?: boolean } | undefined;
    expect(hasRpcError || result?.isError).toBeTruthy();
  });
});

describe('resources/list and resources/read', () => {
  it('lists the built-in system resources', async () => {
    const { body } = await call('resources/list');
    const result = body.result as { resources: { uri: string; name: string }[] };

    expect(result.resources.map((resource) => resource.uri)).toContain('system://health');
  });

  it('lists resource templates separately from concrete resources', async () => {
    const { body } = await call('resources/templates/list');
    const result = body.result as { resourceTemplates: { uriTemplate: string }[] };

    expect(result.resourceTemplates.map((template) => template.uriTemplate)).toContain(
      'system://providers/{providerId}',
    );
  });

  it('reads the health resource as JSON', async () => {
    const { body } = await call('resources/read', { uri: 'system://health' });
    const result = body.result as { contents: { uri: string; text: string }[] };

    const payload = JSON.parse(result.contents[0]!.text) as Record<string, unknown>;
    expect(payload.status).toBe('ok');
    expect(payload.server).toBe('adi-mcp');
    expect(payload.providerCount).toBeGreaterThan(0);
  });

  it('reads a templated provider resource', async () => {
    const { body } = await call('resources/read', { uri: 'system://providers/x' });
    const result = body.result as { contents: { text: string }[] };

    const payload = JSON.parse(result.contents[0]!.text) as {
      id: string;
      tools: { name: string }[];
    };
    expect(payload.id).toBe('x');
    expect(payload.tools.map((tool) => tool.name)).toContain('x_post_tweet');
  });

  it('reports an unknown provider inside the templated resource rather than throwing', async () => {
    const { body } = await call('resources/read', { uri: 'system://providers/nope' });
    const result = body.result as { contents: { text: string }[] };

    const payload = JSON.parse(result.contents[0]!.text) as { error?: string };
    expect(payload.error).toContain('Unknown provider');
  });
});

describe('prompts/list and prompts/get', () => {
  it('lists prompts contributed by providers', async () => {
    const { body } = await call('prompts/list');
    const result = body.result as { prompts: { name: string }[] };

    const names = result.prompts.map((prompt) => prompt.name);
    expect(names).toContain('x_compose_post');
    expect(names).toContain('linkedin_compose_post');
    expect(names).toContain('system_orient');
  });

  it('declares prompt arguments and which are required', async () => {
    const { body } = await call('prompts/list');
    const result = body.result as {
      prompts: { name: string; arguments?: { name: string; required?: boolean }[] }[];
    };

    const compose = result.prompts.find((prompt) => prompt.name === 'x_compose_post')!;
    const topic = compose.arguments?.find((argument) => argument.name === 'topic');
    const tone = compose.arguments?.find((argument) => argument.name === 'tone');

    expect(topic?.required).toBe(true);
    expect(tone?.required).toBe(false);
  });

  it('renders a prompt with its arguments substituted', async () => {
    const { body } = await call('prompts/get', {
      name: 'x_compose_post',
      arguments: { topic: 'shipping Adi MCP', tone: 'technical' },
    });

    const result = body.result as { messages: { content: { text: string } }[] };
    expect(result.messages[0]?.content.text).toContain('shipping Adi MCP');
    expect(result.messages[0]?.content.text).toContain('technical');
  });

  it('renders a prompt with an optional argument omitted', async () => {
    const { body } = await call('prompts/get', {
      name: 'x_compose_post',
      arguments: { topic: 'a topic' },
    });

    const result = body.result as { messages: { content: { text: string } }[] };
    expect(result.messages[0]?.content.text).toContain('a topic');
    expect(result.messages[0]?.content.text).not.toContain('Tone:');
  });

  it('errors on a missing required prompt argument', async () => {
    const { body } = await call('prompts/get', { name: 'x_compose_post', arguments: {} });
    expect(body.error).toBeDefined();
  });
});
