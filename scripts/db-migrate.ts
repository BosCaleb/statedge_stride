// pnpm db:migrate: applies apps/api/migrations to SQL Server in Docker (`pnpm db:up`), creating
// the database and the local API login on first use. With ENVIRONMENT=dev or prod, SQL_SERVER
// and SQL_DATABASE, it runs against Azure SQL with your Azure CLI sign-in instead.
import { fileURLToPath } from 'node:url';
import { migrate } from '../apps/api/src/migrate';

await migrate(
  process.argv.slice(2),
  fileURLToPath(new URL('../apps/api/migrations/', import.meta.url)),
);
