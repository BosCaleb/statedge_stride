import sql from 'mssql';

// Database access. Every query on organisation data runs inside withOrg(orgId, fn), which pins a
// pooled connection in a transaction, sets the organisation in SESSION_CONTEXT for row-level
// security, runs fn and clears the context again before the connection goes back to the pool.
// Context is always set at the start as well: nothing relies on it surviving pool reuse.
//
// Two narrower helpers exist for the moments before the organisation is known: withIdentity
// (resolve the coach for a verified token) and withInviteToken (accept an invite). withoutOrg
// reads the tables that have no row-level security (shared_reports, device_profiles).

export type SqlType = sql.ISqlType | (() => sql.ISqlType);
export type SqlParams = Record<string, readonly [SqlType, unknown]>;

export interface Db {
  query<T>(text: string, params?: SqlParams): Promise<T[]>;
  /** Runs a statement and returns the number of rows it affected. */
  execute(text: string, params?: SqlParams): Promise<number>;
}

export interface DbSettings {
  server: string;
  database: string;
  port?: number;
  /** "entra": managed identity in Azure, Azure CLI credentials for staff scripts and CI. */
  auth: 'entra' | 'sql';
  /** SQL authentication, local development and tests only. */
  user?: string;
  password?: string;
  /** Local SQL Server in Docker uses a self-signed certificate. */
  trustServerCertificate?: boolean;
  /** Connections in the pool. */
  poolMax?: number;
}

export function poolConfig(s: DbSettings): sql.config {
  const base: sql.config = {
    server: s.server,
    database: s.database,
    port: s.port ?? 1433,
    options: { encrypt: true, trustServerCertificate: s.trustServerCertificate ?? false },
    pool: { max: s.poolMax ?? 10, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
  };
  if (s.auth === 'entra') {
    return { ...base, authentication: { type: 'azure-active-directory-default', options: {} } };
  }
  return { ...base, user: s.user ?? '', password: s.password ?? '' };
}

function bind(request: sql.Request, params: SqlParams): sql.Request {
  for (const [name, [type, value]] of Object.entries(params)) request.input(name, type, value);
  return request;
}

/**
 * A transaction holds one connection, which runs one request at a time. Requests are queued, so
 * that an accidental Promise.all inside withOrg waits its turn instead of wedging the connection.
 */
function dbOn(tx: sql.Transaction): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
  return {
    query: <T>(text: string, params: SqlParams = {}) =>
      serial(async () => (await bind(new sql.Request(tx), params).query<T>(text)).recordset ?? []),
    execute: (text: string, params: SqlParams = {}) =>
      serial(async () =>
        (await bind(new sql.Request(tx), params).query(text)).rowsAffected.reduce(
          (a, b) => a + b,
          0,
        ),
      ),
  };
}

interface Context {
  orgId: string | null;
  entraOid: string | null;
  inviteTokenHash: Buffer | null;
}

const NO_CONTEXT: Context = { orgId: null, entraOid: null, inviteTokenHash: null };

const SET_CONTEXT = `SET XACT_ABORT ON;
EXEC sp_set_session_context @key = N'org_id', @value = @org_id;
EXEC sp_set_session_context @key = N'entra_oid', @value = @entra_oid;
EXEC sp_set_session_context @key = N'invite_token_hash', @value = @invite_token_hash;`;

async function setContext(tx: sql.Transaction, c: Context): Promise<void> {
  await bind(new sql.Request(tx), {
    org_id: [sql.UniqueIdentifier, c.orgId],
    entra_oid: [sql.UniqueIdentifier, c.entraOid],
    invite_token_hash: [sql.VarBinary(32), c.inviteTokenHash],
  }).query(SET_CONTEXT);
}

export interface Database {
  withOrg<T>(orgId: string, fn: (db: Db) => Promise<T>): Promise<T>;
  withIdentity<T>(entraOid: string, fn: (db: Db) => Promise<T>): Promise<T>;
  /** fn may call enterOrg once it has read the invite, to continue in that organisation. */
  withInviteToken<T>(
    tokenHash: Buffer,
    fn: (db: Db, enterOrg: (orgId: string) => Promise<void>) => Promise<T>,
  ): Promise<T>;
  withoutOrg<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** The raw pool, for the migration runner and tests. Not for organisation data. */
  pool(): Promise<sql.ConnectionPool>;
  close(): Promise<void>;
}

export function createDatabase(settings: DbSettings): Database {
  let poolPromise: Promise<sql.ConnectionPool> | null = null;
  const pool = () => {
    poolPromise ??= new sql.ConnectionPool(poolConfig(settings))
      .connect()
      .catch((error: unknown) => {
        poolPromise = null;
        throw error;
      });
    return poolPromise;
  };

  const run = async <T>(
    context: Context,
    fn: (db: Db, tx: sql.Transaction) => Promise<T>,
  ): Promise<T> => {
    const tx = new sql.Transaction(await pool());
    await tx.begin();
    try {
      await setContext(tx, context);
      const result = await fn(dbOn(tx), tx);
      await setContext(tx, NO_CONTEXT);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await setContext(tx, NO_CONTEXT);
      } catch {
        // A doomed transaction may refuse; the next transaction sets its own context anyway.
      }
      try {
        await tx.rollback();
      } catch {
        // Already rolled back by XACT_ABORT.
      }
      throw error;
    }
  };

  return {
    withOrg: (orgId, fn) => run({ ...NO_CONTEXT, orgId }, (db) => fn(db)),
    withIdentity: (entraOid, fn) => run({ ...NO_CONTEXT, entraOid }, (db) => fn(db)),
    withInviteToken: (tokenHash, fn) =>
      run({ ...NO_CONTEXT, inviteTokenHash: tokenHash }, (db, tx) =>
        fn(db, (orgId) => setContext(tx, { orgId, entraOid: null, inviteTokenHash: tokenHash })),
      ),
    withoutOrg: (fn) => run(NO_CONTEXT, (db) => fn(db)),
    pool,
    async close() {
      if (poolPromise) await (await poolPromise).close();
      poolPromise = null;
    },
  };
}

/** Lower-case a GUID from SQL Server (which returns upper case) for comparison with client ids. */
export function guid(value: string): string;
export function guid(value: string | null): string | null;
export function guid(value: string | null): string | null {
  return value === null ? null : value.toLowerCase();
}

/** A DATE column as YYYY-MM-DD. */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
