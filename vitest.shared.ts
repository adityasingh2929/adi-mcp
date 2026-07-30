import { defineProject, mergeConfig, type UserConfig } from 'vitest/config';

/** Shared base for every package/app's vitest.config.ts, merged with local overrides. */
export function createVitestProject(name: string, overrides: UserConfig = {}) {
  return mergeConfig(
    defineProject({
      test: {
        name,
        environment: 'node',
        globals: false,
        include: ['test/**/*.test.ts'],
      },
    }),
    defineProject(overrides),
  );
}
