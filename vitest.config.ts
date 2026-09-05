import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    /**
     * Integration tests write real rows, so they get their own database and a
     * throwaway session secret. Pointing at the development database here would
     * mean a test run could delete real prospects.
     */
    env: {
      DATABASE_URL: `file:${path.resolve(__dirname, 'prisma/test.db')}`,
      SESSION_SECRET: 'test-only-secret-not-used-for-anything-real-0123456789',
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'console',
    },
    // The gate tests share one database, so they must not run concurrently.
    fileParallelism: false,
    /**
     * The integration tests do real database work — several round trips per
     * assertion against SQLite. They sat right on the 5s default, so which
     * ones failed varied between runs. This is headroom, not a slow test
     * being tolerated: they complete in 1-5s each.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // See tests/stubs/server-only.ts for why this is safe.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
