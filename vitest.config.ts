import { defineConfig } from 'vitest/config';

// Each workspace has its own project. `api-db` needs SQL Server (docker compose up -d sql),
// so the default `pnpm test` leaves it out and CI runs it in its own job.
export default defineConfig({
  test: {
    projects: [
      'packages/analysis',
      'packages/shared',
      'apps/web',
      'apps/api/vitest.config.ts',
      'apps/api/vitest.db.config.ts',
    ],
  },
});
