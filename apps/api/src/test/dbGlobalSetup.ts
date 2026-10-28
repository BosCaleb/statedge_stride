import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import type { TestProject } from 'vitest/node';
import { applyMigrations, grantApiUser, loadMigrations } from '../lib/migrations';

// Creates a fresh stride_test database on the SQL Server from `pnpm db:up` (or the CI service
// container), applies every migration, and creates a login with exactly the API's permissions
// so that row-level security is tested as the API identity, not as an administrator.

export interface TestDbSettings {
  server: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
  apiUser: string;
  apiPassword: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: TestDbSettings;
  }
}

export async function setup(project: TestProject): Promise<void> {
  const settings: TestDbSettings = {
    server: process.env.STRIDE_TEST_SQL_SERVER ?? 'localhost',
    port: Number(process.env.STRIDE_TEST_SQL_PORT ?? 1433),
    database: 'stride_test',
    adminUser: 'sa',
    adminPassword: process.env.STRIDE_TEST_SQL_SA_PASSWORD ?? 'Stride-local-dev-1',
    apiUser: 'stride_api_test',
    apiPassword: 'Stride-api-test-1',
  };
  const connect = (database: string) =>
    new sql.ConnectionPool({
      server: settings.server,
      port: settings.port,
      user: settings.adminUser,
      password: settings.adminPassword,
      database,
      options: { encrypt: true, trustServerCertificate: true },
    }).connect();

  const master = await connect('master');
  await master.request().batch(`IF DB_ID(N'stride_test') IS NOT NULL
BEGIN
  ALTER DATABASE stride_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  DROP DATABASE stride_test;
END;
CREATE DATABASE stride_test;
IF SUSER_ID(N'stride_api_test') IS NULL
  CREATE LOGIN stride_api_test WITH PASSWORD = N'Stride-api-test-1', CHECK_POLICY = OFF;`);
  await master.close();

  const db = await connect(settings.database);
  const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
  await applyMigrations(db, await loadMigrations(dir));
  await grantApiUser(db, settings.apiUser, { kind: 'login' });
  await db.close();
  project.provide('testDb', settings);
}
