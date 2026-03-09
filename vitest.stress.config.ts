import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/serverStress.test.ts',
      'tests/performanceProfile.test.ts'
    ],
    exclude: [
      'node_modules/**',
      '.coverage-v8/**',
      'coverage/**',
      'out/**',
      'out-server/**'
    ]
  }
});
