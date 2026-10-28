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

/** Who gets the API's permissions. */
export type GrantTarget =
  /** A SQL login of the same name (SQL Server in Docker). */
  | { kind: 'login' }
  /**
   * An Entra identity. With its id (the client id of a managed identity or app, the object id
   * of a person) the user is created from that id without asking Entra. By name alone, Azure SQL
   * looks it up, which needs Directory Readers rights for the server when a service principal
   * such as the deploy pipeline runs the statement.
   */
  | { kind: 'entra'; id: string | null };

/**
 * Grants a database user the API's least-privilege permissions: read, write and execute in the
 * stride schema, never db_owner (members of db_owner can switch row-level security off). A user
 * created from an id that no longer matches (the identity was recreated) is dropped and created
 * again. With `dryRun`, returns the statements instead of running them.
 */
export async function grantApiUser(
  pool: sql.ConnectionPool,
  name: string,
  target: GrantTarget,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  const result = await pool
    .request()
    .input('name', sql.NVarChar(128), name)
    .input('kind', sql.NVarChar(10), target.kind)
    .input('id', sql.UniqueIdentifier, target.kind === 'entra' ? target.id : null)
    .input('run', sql.Bit, !options.dryRun).query<{
    statement: string;
  }>(`DECLARE @sid VARBINARY(16) = CONVERT(VARBINARY(16), @id);
DECLARE @statements TABLE (n INT IDENTITY, statement NVARCHAR(600));
IF @sid IS NOT NULL AND EXISTS (
  SELECT 1 FROM sys.database_principals WHERE name = @name AND sid <> @sid)
  INSERT @statements (statement) VALUES (N'DROP USER ' + QUOTENAME(@name));
IF USER_ID(@name) IS NULL OR EXISTS (SELECT 1 FROM @statements)
  INSERT @statements (statement) VALUES (CASE
    WHEN @kind = N'login' THEN N'CREATE USER ' + QUOTENAME(@name) + N' FOR LOGIN ' + QUOTENAME(@name)
    WHEN @sid IS NOT NULL
      THEN N'CREATE USER ' + QUOTENAME(@name) + N' WITH SID = ' + CONVERT(NVARCHAR(34), @sid, 1) + N', TYPE = E'
    ELSE N'CREATE USER ' + QUOTENAME(@name) + N' FROM EXTERNAL PROVIDER' END);
INSERT @statements (statement) VALUES
  (N'ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@name)),
  (N'ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@name)),
  (N'GRANT EXECUTE ON SCHEMA::stride TO ' + QUOTENAME(@name));
IF @run = 1
BEGIN
  DECLARE @n INT = 1, @statement NVARCHAR(600);
  WHILE @n <= (SELECT MAX(n) FROM @statements)
  BEGIN
    SELECT @statement = statement FROM @statements WHERE n = @n;
    EXEC sp_executesql @statement;
    SET @n += 1;
  END;
END;
SELECT statement FROM @statements ORDER BY n;`);
  return result.recordset.map((r) => r.statement);
}
