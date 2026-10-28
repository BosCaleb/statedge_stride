import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDatabase, apiDatabase, createTestOrg, insertAthlete, type TestOrg } from '../test/db';
import { guid } from './db';
import { applyMigrations, grantApiUser, loadMigrations } from './migrations';

// Row-level security across two organisations, tested as the API identity.

const api = apiDatabase(1); // one pooled connection, so every call reuses the same session
const admin = adminDatabase();
let a: TestOrg;
let b: TestOrg;
let athleteA: string;
let athleteB: string;

beforeAll(async () => {
  a = await createTestOrg(admin, 'Organisation A');
  b = await createTestOrg(admin, 'Organisation B');
  athleteA = await insertAthlete(admin, a, 'Ayanda');
  athleteB = await insertAthlete(admin, b, 'Bongani');
});

afterAll(async () => {
  await api.close();
  await admin.close();
});

const countAthletes = (rows: { n: number }[]) => rows[0]?.n ?? -1;

describe('row-level security', () => {
  it('returns no rows to a query without an organisation context', async () => {
    const pool = await api.pool();
    const raw = await pool
      .request()
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.athletes');
    expect(countAthletes(raw.recordset)).toBe(0);
    const orgs = await pool
      .request()
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.organisations');
    expect(countAthletes(orgs.recordset)).toBe(0);
    const viaHelper = await api.withoutOrg((db) =>
      db.query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.athletes'),
    );
    expect(countAthletes(viaHelper)).toBe(0);
  });

  it("never returns one organisation's rows in another's context", async () => {
    const rows = await api.withOrg(a.orgId, (db) =>
      db.query<{ id: string; org_id: string }>('SELECT id, org_id FROM stride.athletes'),
    );
    expect(rows.map((r) => guid(r.id))).toEqual([athleteA]);
    const coaches = await api.withOrg(b.orgId, (db) =>
      db.query<{ org_id: string }>('SELECT org_id FROM stride.coaches'),
    );
    expect(coaches).toHaveLength(2);
    expect(coaches.every((c) => guid(c.org_id) === b.orgId)).toBe(true);
  });

  it('clears the context before the connection goes back to the pool', async () => {
    await api.withOrg(a.orgId, (db) => db.query('SELECT 1 AS x'));
    const pool = await api.pool();
    const after = await pool
      .request()
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.athletes');
    expect(countAthletes(after.recordset)).toBe(0);
    // ...also after a failed transaction.
    await expect(api.withOrg(a.orgId, (db) => db.query('SELECT 1 / 0 AS boom'))).rejects.toThrow();
    const afterError = await pool
      .request()
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.athletes');
    expect(countAthletes(afterError.recordset)).toBe(0);
  });

  it('blocks writing a row into another organisation', async () => {
    await expect(
      api.withOrg(a.orgId, (db) =>
        db.execute(
          "INSERT INTO stride.athletes (id, org_id, first_name, last_name, birth_year, created_by) VALUES (@id, @org, N'X', N'Y', 2000, @by)",
          {
            id: [sql.UniqueIdentifier, randomUUID()],
            org: [sql.UniqueIdentifier, b.orgId],
            by: [sql.UniqueIdentifier, b.coachId],
          },
        ),
      ),
    ).rejects.toThrow(/block predicate/i);
  });

  it("blocks moving a row into another organisation, and cannot touch another's rows", async () => {
    await expect(
      api.withOrg(a.orgId, (db) =>
        db.execute('UPDATE stride.athletes SET org_id = @other WHERE id = @id', {
          other: [sql.UniqueIdentifier, b.orgId],
          id: [sql.UniqueIdentifier, athleteA],
        }),
      ),
    ).rejects.toThrow(/block predicate/i);
    const updated = await api.withOrg(a.orgId, (db) =>
      db.execute("UPDATE stride.athletes SET first_name = N'Changed' WHERE id = @id", {
        id: [sql.UniqueIdentifier, athleteB],
      }),
    );
    expect(updated).toBe(0);
    const deleted = await api.withOrg(a.orgId, (db) =>
      db.execute('DELETE FROM stride.consents WHERE athlete_id = @id', {
        id: [sql.UniqueIdentifier, athleteB],
      }),
    );
    expect(deleted).toBe(0);
  });

  it('resolves a coach from a verified identity, and only that coach', async () => {
    const rows = await api.withIdentity(a.coachOid, (db) =>
      db.query<{ id: string }>('SELECT id FROM stride.coaches'),
    );
    expect(rows.map((r) => guid(r.id))).toEqual([a.coachId]);
    const athletes = await api.withIdentity(a.coachOid, (db) =>
      db.query('SELECT id FROM stride.athletes'),
    );
    expect(athletes).toEqual([]);
    // The identity context cannot be used to change the coach row.
    await expect(
      api.withIdentity(a.coachOid, (db) =>
        db.execute("UPDATE stride.coaches SET role = 'admin' WHERE entra_oid = @oid", {
          oid: [sql.UniqueIdentifier, a.coachOid],
        }),
      ),
    ).rejects.toThrow(/block predicate/i);
  });

  it('finds an invite by its token hash only, then continues in its organisation', async () => {
    const token = createHash('sha256').update(randomUUID()).digest();
    await admin.withOrg(a.orgId, (db) =>
      db.execute(
        "INSERT INTO stride.invites (org_id, email, role, token_hash, expires_at) VALUES (@org, N'new@example.org', 'coach', @hash, DATEADD(day, 7, SYSUTCDATETIME()))",
        { org: [sql.UniqueIdentifier, a.orgId], hash: [sql.VarBinary(32), token] },
      ),
    );
    const found = await api.withInviteToken(token, async (db, enterOrg) => {
      const invites = await db.query<{ org_id: string }>('SELECT org_id FROM stride.invites');
      const orgId = guid(invites[0]?.org_id ?? '');
      await enterOrg(orgId);
      const athletes = await db.query<{ id: string }>('SELECT id FROM stride.athletes');
      return { invites: invites.length, orgId, athletes: athletes.map((r) => guid(r.id)) };
    });
    expect(found).toEqual({ invites: 1, orgId: a.orgId, athletes: [athleteA] });
    const wrong = await api.withInviteToken(createHash('sha256').update('nope').digest(), (db) =>
      db.query('SELECT id FROM stride.invites'),
    );
    expect(wrong).toEqual([]);
  });

  it('does not let the API identity switch row-level security off', async () => {
    const pool = await api.pool();
    await expect(
      pool.request().batch('ALTER SECURITY POLICY security.org_isolation WITH (STATE = OFF)'),
    ).rejects.toThrow(/permission|cannot find|does not exist/i);
    await expect(
      pool.request().batch('DROP SECURITY POLICY security.org_isolation'),
    ).rejects.toThrow();
  });
});

describe('migrations', () => {
  it('are recorded with checksums, and re-running applies nothing', async () => {
    const pool = await admin.pool();
    const dir = fileURLToPath(new URL('../../migrations/', import.meta.url));
    const migrations = await loadMigrations(dir);
    expect(await applyMigrations(pool, migrations)).toEqual([]);
    const changed = migrations.map((m) => ({ ...m, checksum: '0'.repeat(64) }));
    await expect(applyMigrations(pool, changed)).rejects.toThrow(/changed after it was applied/);
  });
});

describe('grants', () => {
  const API_GRANTS = (name: string) => [
    `ALTER ROLE db_datareader ADD MEMBER [${name}]`,
    `ALTER ROLE db_datawriter ADD MEMBER [${name}]`,
    `GRANT EXECUTE ON SCHEMA::stride TO [${name}]`,
  ];

  it('creates an Entra user from its id, with the bytes in the order Azure SQL stores them', async () => {
    const pool = await admin.pool();
    // Azure SQL keeps an Entra SID as the GUID's bytes in Windows order: the first three groups
    // little-endian, the rest as written.
    const statements = await grantApiUser(
      pool,
      'id-stride-dev-san-api',
      { kind: 'entra', id: '00112233-4455-6677-8899-aabbccddeeff' },
      { dryRun: true },
    );
    expect(statements).toEqual([
      'CREATE USER [id-stride-dev-san-api] WITH SID = 0x33221100554477668899AABBCCDDEEFF, TYPE = E',
      ...API_GRANTS('id-stride-dev-san-api'),
    ]);
  });

  it('looks a name up in Entra only when no id is given, and quotes every name', async () => {
    const pool = await admin.pool();
    const statements = await grantApiUser(
      pool,
      'odd]name@statedge.co.za',
      { kind: 'entra', id: null },
      { dryRun: true },
    );
    expect(statements[0]).toBe('CREATE USER [odd]]name@statedge.co.za] FROM EXTERNAL PROVIDER');
  });

  it('recreates a user whose id no longer matches, and leaves a matching one alone', async () => {
    const pool = await admin.pool();
    // The API login exists with a SQL SID, so any Entra id is a mismatch.
    const replaced = await grantApiUser(
      pool,
      'stride_api_test',
      { kind: 'entra', id: randomUUID() },
      { dryRun: true },
    );
    expect(replaced[0]).toBe('DROP USER [stride_api_test]');
    expect(replaced[1]).toMatch(
      /^CREATE USER \[stride_api_test\] WITH SID = 0x[0-9A-F]{32}, TYPE = E$/,
    );
    const kept = await grantApiUser(pool, 'stride_api_test', { kind: 'login' }, { dryRun: true });
    expect(kept).toEqual(API_GRANTS('stride_api_test'));
  });
});
