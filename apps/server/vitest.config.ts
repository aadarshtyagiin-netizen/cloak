import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test file runs in its own process (default isolation), so the Prisma
    // and Redis singletons are per-file and can be safely torn down in afterAll.
    pool: 'forks',
  },
});
