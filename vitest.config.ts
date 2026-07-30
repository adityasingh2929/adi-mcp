import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Stale per-package HTML reports would otherwise be instrumented as source.
        '**/coverage/**',
        '**/test/**',
        'scripts/**',
        'vitest.shared.ts',
        // Type-only modules: interfaces and type aliases compile away, so v8 reports them
        // as 0/0 statements and drags the whole number down for no signal.
        'packages/*/src/types.ts',
        'shared/src/env.ts',
        // Worker entry point. It only wires createApp() to the runtime's fetch handler;
        // the app itself is covered through app.fetch() in apps/server/test.
        'apps/server/src/index.ts',
      ],
    },
  },
});
