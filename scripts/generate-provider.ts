/**
 * Scaffolds a new provider package under packages/<id>/ with the standard shape.
 *
 *   pnpm scaffold:provider <id> "<Display Name>" <credential-kind>
 *
 * credential-kind: oauth2 | api-key | bearer | local | none
 *
 * After running, add the provider to apps/server/src/providers.ts — Workers bundle
 * statically, so registration cannot be discovered at runtime. See docs/ADDING_PROVIDERS.md.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CREDENTIAL_KINDS = ['oauth2', 'api-key', 'bearer', 'local', 'none'] as const;
type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

const [id, displayName, credentialKind = 'none'] = process.argv.slice(2);

if (!id || !displayName) {
  console.error('Usage: pnpm scaffold:provider <id> "<Display Name>" [credential-kind]');
  process.exit(1);
}

if (!CREDENTIAL_KINDS.includes(credentialKind as CredentialKind)) {
  console.error(`credential-kind must be one of: ${CREDENTIAL_KINDS.join(', ')}`);
  process.exit(1);
}

const root = join(process.cwd(), 'packages', id);

if (existsSync(root)) {
  console.error(`packages/${id} already exists.`);
  process.exit(1);
}

mkdirSync(join(root, 'src', 'tools'), { recursive: true });
mkdirSync(join(root, 'test'), { recursive: true });

writeFileSync(
  join(root, 'package.json'),
  `${JSON.stringify(
    {
      name: `@adi-mcp/${id}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      main: './src/index.ts',
      types: './src/index.ts',
      exports: { '.': './src/index.ts' },
      scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
      dependencies: {
        '@adi-mcp/auth': 'workspace:*',
        '@adi-mcp/core': 'workspace:*',
        '@adi-mcp/shared': 'workspace:*',
        zod: '^3.24.1',
      },
      devDependencies: {
        '@cloudflare/workers-types': '^4.20250109.0',
        typescript: '^5.7.3',
        vitest: '^3.0.4',
      },
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(root, 'tsconfig.json'),
  `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: { noEmit: true, types: ['@cloudflare/workers-types'] },
      include: ['src', 'test'],
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(root, 'vitest.config.ts'),
  `import { createVitestProject } from '../../vitest.shared.js';\n\nexport default createVitestProject('${id}');\n`,
);

writeFileSync(
  join(root, 'src', 'index.ts'),
  `import type { Provider } from '@adi-mcp/core';

export const ${id}Provider: Provider = {
  id: '${id}',
  displayName: '${displayName}',
  description: 'TODO: describe what this provider exposes.',
  credential: {
    kind: '${credentialKind}',
    description: 'TODO: describe the credentials this provider needs.',
  },
  tools: [],
};
`,
);

console.log(`Scaffolded packages/${id}.`);
console.log(`Next: implement src/tools/, then register it in apps/server/src/providers.ts.`);
