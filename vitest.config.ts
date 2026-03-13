import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/bootstrap.test.ts', 'tests/analytics.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/viewer.html',
        'src/viewer.ts',
        'src/preview.ts',
        'src/cli.ts',
        'src/skill-eval.ts',
        'src/analytics/analyze.ts',
        'src/providers/docker.ts',
        'src/reporters/browser.ts',
        'src/core/config.types.ts',
        'src/types.ts',
        'src/commands/run.ts',
        'src/commands/init.ts',
      ],
    },
  },
});
