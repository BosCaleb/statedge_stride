import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sql from 'mssql';

// Applies the numbered .sql files in apps/api/migrations in order and records each in
// stride.schema_migrations with a checksum. An applied migration whose file changed is an
// error: migrations are append-only. Each migration runs in one transaction.

export interface Migration {
  id: string;
  text: string;
  checksum: string;
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const text = await readFile(join(dir, file), 'utf8');
      return { id: file, text, checksum: createHash('sha256').update(text).digest('hex') };
    }),
  );
}

/** Splits a script into batches on lines that contain only GO. */
export function splitBatches(text: string): string[] {
  return text
    .split(/^\s*GO\s*;?\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.replace(/--.*$/gm, '').trim().length > 0);
}

const BOOTSTRAP = `IF SCHEMA_ID(N'stride') IS NULL EXEC (N'CREATE SCHEMA stride');
IF OBJECT_ID(N'stride.schema_migrations') IS NULL
  CREATE TABLE stride.schema_migrations (
    id NVARCHAR(200) NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME2(0) NOT NULL CONSTRAINT DF_schema_migrations_at DEFAULT SYSUTCDATETIME()
  );`;

export async function applyMigrations(
  pool: sql.ConnectionPool,
  migrations: readonly Migration[],
  log: (message: string) => void = () => undefined,
): Promise<string[]> {
  await pool.request().query(BOOTSTRAP);
  const applied = new Map(
    (
      await pool
        .request()
        .query<{ id: string; checksum: string }>(
          'SELECT id, checksum FROM stride.schema_migrations',
        )
    ).recordset.map((r) => [r.id, r.checksum]),
  );
  const done: string[] = [];
  for (const m of migrations) {
    const previous = applied.get(m.id);
    if (previous !== undefined) {
      if (previous !== m.checksum)
        throw new Error(`migration ${m.id} changed after it was applied`);
      continue;
    }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const batch of splitBatches(m.text)) await new sql.Request(tx).batch(batch);
      await new sql.Request(tx)
        .input('id', sql.NVarChar(200), m.id)
        .input('checksum', sql.Char(64), m.checksum)
        .query('INSERT INTO stride.schema_migrations (id, checksum) VALUES (@id, @checksum)');
      await tx.commit();
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw new Error(
        `migration ${m.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
    log(`applied ${m.id}`);
    done.push(m.id);
  }
  return done;
}

/**
 * Grants a database user the API's least-privilege permissions: read, write and execute in the
 * stride schema, never db_owner (members of db_owner can switch row-level security off).
 * `external` creates the user for an Entra identity (the Function App's managed identity).
 */
export async function grantApiUser(
  pool: sql.ConnectionPool,
  name: string,
  external: boolean,
): Promise<void> {
  await pool.request().input('name', sql.NVarChar(128), name).input('external', sql.Bit, external)
    .query(`IF USER_ID(@name) IS NULL
BEGIN
  DECLARE @create NVARCHAR(400) = CASE WHEN @external = 1
    THEN N'CREATE USER ' + QUOTENAME(@name) + N' FROM EXTERNAL PROVIDER'
    ELSE N'CREATE USER ' + QUOTENAME(@name) + N' FOR LOGIN ' + QUOTENAME(@name) END;
  EXEC sp_executesql @create;
END;
DECLARE @grants NVARCHAR(600) =
  N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@name) + N'; ' +
  N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@name) + N'; ' +
  N'GRANT EXECUTE ON SCHEMA::stride TO ' + QUOTENAME(@name) + N';';
EXEC sp_executesql @grants;`);
}
