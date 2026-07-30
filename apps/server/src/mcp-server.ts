import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  toToolResult,
  type AnyPromptDefinition,
  type AnyToolDefinition,
  type ExecutionContext,
  type ProviderRegistry,
  type ResourceDefinition,
} from '@adi-mcp/core';

export const SERVER_INFO = {
  name: 'adi-mcp',
  version: '0.1.0',
  title: 'Adi MCP',
} as const;

/**
 * Serializes a tool's return value into MCP `content`. Structured results are echoed as
 * pretty JSON text so clients without structured-output support still get something useful,
 * while `structuredContent` carries the typed payload for those that do.
 */
function toContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function registerTool(server: McpServer, tool: AnyToolDefinition, ctx: ExecutionContext): void {
  server.registerTool(
    tool.name,
    {
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    },
    async (args: unknown): Promise<CallToolResult> => {
      const toolLogger = ctx.logger.child({ tool: tool.name });
      const startedAt = Date.now();
      try {
        // The SDK has already validated `args` against `tool.inputSchema` by this point;
        // `execute` is typed per-tool but erased to `any` in this heterogeneous registry.
        const output: unknown = await tool.execute(args, { ...ctx, logger: toolLogger });
        toolLogger.info('Tool succeeded', { durationMs: Date.now() - startedAt });

        // `structuredContent` is only valid when the tool declares an outputSchema; sending it
        // otherwise makes spec-compliant clients reject the response.
        return tool.outputSchema
          ? {
              content: [{ type: 'text', text: toContentText(output) }],
              structuredContent: output as Record<string, unknown>,
            }
          : { content: [{ type: 'text', text: toContentText(output) }] };
      } catch (error) {
        toolLogger.error('Tool failed', {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        return toToolResult(error) as CallToolResult;
      }
    },
  );
}

function registerResource(
  server: McpServer,
  resource: ResourceDefinition,
  ctx: ExecutionContext,
): void {
  const config = {
    ...(resource.title ? { title: resource.title } : {}),
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  };

  const read = async (uri: URL): Promise<ReadResourceResult> => {
    const contents = await resource.read(uri.toString(), ctx);
    return { contents: contents.map((content) => ({ ...content })) };
  };

  if (resource.isTemplate) {
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.uri, { list: undefined }),
      config,
      read,
    );
  } else {
    server.registerResource(resource.name, resource.uri, config, read);
  }
}

function registerPrompt(
  server: McpServer,
  prompt: AnyPromptDefinition,
  ctx: ExecutionContext,
): void {
  server.registerPrompt(
    prompt.name,
    {
      ...(prompt.title ? { title: prompt.title } : {}),
      ...(prompt.description ? { description: prompt.description } : {}),
      ...(prompt.argsSchema ? { argsSchema: prompt.argsSchema } : {}),
    },
    async (args: Record<string, string | undefined>): Promise<GetPromptResult> => {
      const messages = await prompt.build(args ?? {}, ctx);
      return { messages: messages.map((message) => ({ ...message })) };
    },
  );
}

/**
 * Builds a fresh {@link McpServer} for a single request. Workers isolates do not keep
 * per-session state between requests, so the server runs stateless: every request gets a
 * new server + transport pair wired to the same {@link ProviderRegistry}.
 */
export function createMcpServer(registry: ProviderRegistry, ctx: ExecutionContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    instructions:
      'Adi MCP aggregates tools from multiple services behind one endpoint. Tool names are ' +
      'prefixed with their provider id (e.g. `x_post_tweet`). If a tool returns an ' +
      'AUTH_REQUIRED error, the user must connect that provider at /providers/<id>/connect first.',
  });

  for (const tool of registry.getTools()) registerTool(server, tool, ctx);
  for (const resource of registry.getResources()) registerResource(server, resource, ctx);
  for (const prompt of registry.getPrompts()) registerPrompt(server, prompt, ctx);

  return server;
}
