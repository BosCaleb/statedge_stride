import { parseArgs } from 'node:util';
import sql from 'mssql';
import { z } from 'zod';
import { poolConfig, type DbSettings } from './lib/db';
import { applyMigrations, grantApiUser, loadMigrations } from './lib/migrations';

// The migration command, bundled to .deploy/migrate.mjs (see migrateMain.ts) for the deploy
// workflows and run from the repository by `pnpm db:migrate`. In Azure it signs in with the
// pipeline's Entra identity (Azure CLI credentials after azure/login) and grants the API's
// managed identity, and any staff named, the API's least-privilege permissions. Each --grant is
// a name and, after "=", the Entra id to create the user from: the client id of a managed
// identity, or the object id of a person. Locally it creates the database and an API login
// first, so that the local API runs under row-level security as it does in Azure.
//
//   node migrate.mjs --grant id-stride-dev-san-api=<client id> [--grant someone@statedge.co.za=<object id>]
//   pnpm db:migrate

const LOCAL = {
  server: 'localhost',
  database: 'stride',
  adminUser: 'sa',
  adminPassword: process.env.STRIDE_LOCAL_SA_PASSWORD ?? 'Stride-local-dev-1',
  apiLogin: 'stride_api',
  apiPassword: process.env.STRIDE_LOCAL_API_PASSWORD ?? 'Stride-api-local-1',
};

/** Error numbers Azure SQL returns while a paused serverless database resumes. */
const RESUMING = new Set([40613, 40197, 40501, 49918, 49919, 49920]);

export async function connectWithRetry(
  config: sql.config,
  attempts = 8,
): Promise<sql.ConnectionPool> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (error) {
      const number = (error as { originalError?: { info?: { number?: number } } }).originalError
        ?.info?.number;
      const transient =
        number === undefined
          ? /timeout|ETIMEOUT|ESOCKET/i.test(String(error))
          : RESUMING.has(number);
      if (!transient || attempt >= attempts) throw error;
      console.log(`database not ready (attempt ${attempt}), retrying in 15 s`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

export function localAdminSettings(database: string): DbSettings {
  return {
    server: process.env.SQL_SERVER ?? LOCAL.server,
    database,
    auth: 'sql',
    user: LOCAL.adminUser,
    password: LOCAL.adminPassword,
    trustServerCertificate: true,
  };
}

/** Admin settings for scripts: SQL Server in Docker locally, Entra sign-in in Azure. */
export function scriptDbSettings(): DbSettings & { local: boolean } {
  const environment = process.env.ENVIRONMENT ?? 'local';
  if (environment === 'local')
    return { ...localAdminSettings(process.env.SQL_DATABASE ?? LOCAL.database), local: true };
  const server = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!server || !database)
    throw new Error('SQL_SERVER and SQL_DATABASE are required outside ENVIRONMENT=local');
  return { server, database, auth: 'entra', local: false };
}

async function ensureLocalDatabase(database: string): Promise<void> {
  const master = await connectWithRetry(poolConfig(localAdminSettings('master')), 3);
  await master
    .request()
    .input('db', sql.NVarChar(128), database)
    .input('login', sql.NVarChar(128), LOCAL.apiLogin)
    .input('password', sql.NVarChar(128), LOCAL.apiPassword).query(`IF DB_ID(@db) IS NULL
BEGIN
  DECLARE @create NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@db);
  EXEC sp_executesql @create;
END;
IF SUSER_ID(@login) IS NULL
BEGIN
  DECLARE @login_sql NVARCHAR(400) = N'CREATE LOGIN ' + QUOTENAME(@login) + N' WITH PASSWORD = ' + QUOTENAME(@password, '''') + N', CHECK_POLICY = OFF';
  EXEC sp_executesql @login_sql;
END;`);
  await master.close();
}

const grantSchema = z
  .string()
  .regex(/^[^=]{1,128}(=.+)?$/, 'Expected name or name=entra-id')
  .transform((value, ctx) => {
    const at = value.indexOf('=');
    const name = (at < 0 ? value : value.slice(0, at)).trim();
    const id = at < 0 ? null : value.slice(at + 1).trim();
    if (id !== null && !z.guid().safeParse(id).success) {
      ctx.addIssue({ code: 'custom', message: `The Entra id for ${name} is not a GUID` });
      return z.NEVER;
    }
    return { name, id };
  });

/** Parses the --grant values: `name` or `name=entra-id`. */
export function parseGrants(values: readonly string[]): { name: string; id: string | null }[] {
  return values.map((value) => {
    const parsed = grantSchema.safeParse(value);
    if (!parsed.success)
      throw new Error(`--grant ${value}: ${parsed.error.issues[0]?.message ?? 'not valid'}`);
    return parsed.data;
  });
}

export async function migrate(argv: string[], migrationsDir: string): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { grant: { type: 'string', multiple: true } },
  });
  const grants = parseGrants(values.grant ?? []);
  const settings = scriptDbSettings();
  if (settings.local) await ensureLocalDatabase(settings.database);
  const pool = await connectWithRetry(poolConfig(settings));
  try {
    const applied = await applyMigrations(pool, await loadMigrations(migrationsDir), (m) =>
      console.log(m),
    );
    console.log(
      applied.length === 0 ? 'database is up to date' : `applied ${applied.length} migration(s)`,
    );
    if (settings.local) await grantApiUser(pool, LOCAL.apiLogin, { kind: 'login' });
    for (const { name, id } of grants) {
      await grantApiUser(pool, name, { kind: 'entra', id });
      console.log(`granted the API permissions to ${name}`);
    }
  } finally {
    await pool.close();
  }
}
