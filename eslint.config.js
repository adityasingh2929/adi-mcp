// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': 'off',
      // Interfaces (KvStore, ToolDefinition.execute, etc.) are async by contract even when a
      // given implementation happens to be synchronous internally (e.g. InMemoryKvStore).
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Config files and build scripts sit outside every package's tsconfig, so they need their
    // own project for type-aware linting.
    files: [
      '*.config.js',
      '*.config.ts',
      'vitest.shared.ts',
      'scripts/**/*.ts',
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.tools.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- eslint-config-prettier ships no types
  eslintConfigPrettier,
);
