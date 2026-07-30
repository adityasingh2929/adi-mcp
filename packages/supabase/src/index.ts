import { z } from 'zod';
import { NotImplementedError, createTool, type Provider } from '@adi-mcp/core';
import { StaticCredentialProvider } from '@adi-mcp/auth';

export const SUPABASE_PROVIDER_ID = 'supabase';

export const supabaseCredentialProvider = new StaticCredentialProvider(
  SUPABASE_PROVIDER_ID,
  'api-key',
  'SUPABASE_SERVICE_ROLE_KEY',
);

/** Table and column identifiers are interpolated into PostgREST paths, so restrict them. */
const identifier = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Must be a valid SQL identifier.');

const queryTableTool = createTool({
  name: 'supabase_query_table',
  title: 'Query a Supabase table',
  description:
    'Reads rows from a table through the PostgREST API, with optional column selection, ' +
    'equality filters, and ordering. Read-only.',
  inputSchema: z.object({
    table: identifier.describe('Table name in the public schema.'),
    select: z
      .string()
      .max(500)
      .default('*')
      .describe('PostgREST select expression, e.g. "id,name,created_at".'),
    filters: z
      .record(identifier, z.string())
      .optional()
      .describe('Column-to-value equality filters, ANDed together.'),
    orderBy: identifier.optional(),
    ascending: z.boolean().default(true),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number().int(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  // SCAFFOLD: implement with GET {SUPABASE_URL}/rest/v1/{table}, sending the service-role key
  // as both `apikey` and `Authorization: Bearer`.
  execute: async () => {
    throw new NotImplementedError('supabase_query_table');
  },
});

const insertRowTool = createTool({
  name: 'supabase_insert_row',
  title: 'Insert a Supabase row',
  description:
    'Inserts a single row into a table and returns the created record. Runs with the ' +
    'service-role key, which bypasses row-level security — confirm the target table and ' +
    'values with the user before calling.',
  inputSchema: z.object({
    table: identifier,
    values: z.record(identifier, z.unknown()).describe('Column-to-value map for the new row.'),
  }),
  outputSchema: z.object({ row: z.record(z.string(), z.unknown()) }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  // SCAFFOLD: implement with POST {SUPABASE_URL}/rest/v1/{table} and Prefer: return=representation.
  execute: async () => {
    throw new NotImplementedError('supabase_insert_row');
  },
});

export const supabaseProvider: Provider = {
  id: SUPABASE_PROVIDER_ID,
  displayName: 'Supabase',
  description:
    'Query and insert rows through the Supabase PostgREST API. Scaffold — tool schemas and ' +
    'credential wiring are complete; tool execution is not yet implemented.',
  credential: {
    kind: 'api-key',
    description:
      'Requires SUPABASE_URL and the SUPABASE_SERVICE_ROLE_KEY Worker secret. The ' +
      'service-role key bypasses row-level security, so treat it as a full-database credential.',
  },
  tools: [queryTableTool, insertRowTool],
};
