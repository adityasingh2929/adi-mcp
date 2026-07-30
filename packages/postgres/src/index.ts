import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';

export const POSTGRES_PROVIDER_ID = 'postgres';

const runQueryTool = createTool({
  name: 'postgres_run_query',
  title: 'Run a read-only SQL query',
  description:
    'Executes a single read-only SQL statement against the configured Postgres database and ' +
    'returns the rows. Only SELECT and WITH...SELECT statements are permitted; anything that ' +
    'writes is rejected. Always parameterize values rather than interpolating them into the SQL.',
  inputSchema: z.object({
    sql: z
      .string()
      .min(1)
      .max(10_000)
      .describe('A single SELECT (or WITH...SELECT) statement, using $1, $2… placeholders.'),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .max(100)
      .default([])
      .describe('Values bound to the $1, $2… placeholders, in order.'),
    maxRows: z.number().int().min(1).max(10_000).default(500),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number().int(),
    fields: z.array(z.string()),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement with a Postgres driver over Cloudflare Hyperdrive or a TCP socket.
  // The implementation MUST reject non-SELECT statements before execution — the read-only
  // guarantee in this description is load-bearing, not advisory.
  execute: async () => {
    throw new NotImplementedError('postgres_run_query');
  },
});

const describeSchemaTool = createTool({
  name: 'postgres_describe_schema',
  title: 'Describe database schema',
  description:
    'Lists tables and their columns (name, type, nullability) for a schema. Call this before ' +
    'writing a query so the SQL matches the real column names and types. Read-only.',
  inputSchema: z.object({
    schema: z.string().max(63).default('public').describe('Schema name to introspect.'),
    table: z
      .string()
      .max(63)
      .optional()
      .describe('If set, describes only this table instead of every table in the schema.'),
  }),
  outputSchema: z.object({
    tables: z.array(
      z.object({
        name: z.string(),
        columns: z.array(
          z.object({
            name: z.string(),
            dataType: z.string(),
            nullable: z.boolean(),
            isPrimaryKey: z.boolean(),
          }),
        ),
      }),
    ),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement by querying information_schema.columns joined against the primary-key
  // constraints in information_schema.key_column_usage.
  execute: async () => {
    throw new NotImplementedError('postgres_describe_schema');
  },
});

export const postgresProvider: Provider = {
  id: POSTGRES_PROVIDER_ID,
  displayName: 'Postgres',
  description:
    'Read-only SQL access and schema introspection against a Postgres database. Scaffold — ' +
    'tool schemas are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'local',
    description:
      'Connection string in the POSTGRES_CONNECTION_STRING Worker secret. On Workers this ' +
      'should point at a Cloudflare Hyperdrive binding rather than a raw public database. ' +
      'A local instance for development is provided by docker-compose.yml.',
  },
  tools: [runQueryTool, describeSchemaTool],
};
