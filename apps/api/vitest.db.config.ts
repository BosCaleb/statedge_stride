import { defineProject } from 'vitest/config';

// Database tests run against SQL Server in Docker (`pnpm db:up`), with migrations applied by
// the global setup. They run one file at a time because they share one database.
export default defineProject({
  test: {
    name: 'api-db',
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    globalSetup: ['./src/test/dbGlobalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
