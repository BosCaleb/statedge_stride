import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../lib/db';

/** The database as the API identity (row-level security applies). */
export function apiDatabase(poolMax?: number): Database {
  const s = inject('testDb');
  return createDatabase({
    server: s.server,
    port: s.port,
    database: s.database,
    auth: 'sql',
    user: s.apiUser,
    password: s.apiPassword,
    trustServerCertificate: true,
    ...(poolMax === undefined ? {} : { poolMax }),
  });
}

/** The database as an administrator, for arranging test data. */
export function adminDatabase(): Database {
  const s = inject('testDb');
  return createDatabase({
    server: s.server,
    port: s.port,
    database: s.database,
    auth: 'sql',
    user: s.adminUser,
    password: s.adminPassword,
    trustServerCertificate: true,
  });
}

export interface TestOrg {
  orgId: string;
  adminId: string;
  adminOid: string;
  coachId: string;
  coachOid: string;
}

/** Creates an organisation with one admin and one coach. */
export async function createTestOrg(
  db: Database,
  name = 'Test school',
  maxCoaches = 5,
): Promise<TestOrg> {
  const org: TestOrg = {
    orgId: randomUUID(),
    adminId: randomUUID(),
    adminOid: randomUUID(),
    coachId: randomUUID(),
    coachOid: randomUUID(),
  };
  await db.withOrg(org.orgId, async (tx) => {
    await tx.execute(
      "INSERT INTO stride.organisations (id, name, type, max_coaches) VALUES (@id, @name, 'school', @max)",
      {
        id: [sql.UniqueIdentifier, org.orgId],
        name: [sql.NVarChar(200), name],
        max: [sql.Int, maxCoaches],
      },
    );
    for (const [id, oid, role] of [
      [org.adminId, org.adminOid, 'admin'],
      [org.coachId, org.coachOid, 'coach'],
    ] as const) {
      await tx.execute(
        'INSERT INTO stride.coaches (id, org_id, entra_oid, email, display_name, role) VALUES (@id, @org, @oid, @email, @name, @role)',
        {
          id: [sql.UniqueIdentifier, id],
          org: [sql.UniqueIdentifier, org.orgId],
          oid: [sql.UniqueIdentifier, oid],
          email: [sql.NVarChar(320), `${role}-${id.slice(0, 8)}@example.org`],
          name: [sql.NVarChar(200), `${role} ${id.slice(0, 4)}`],
          role: [sql.VarChar(10), role],
        },
      );
    }
  });
  return org;
}

export async function insertAthlete(
  db: Database,
  org: TestOrg,
  firstName = 'Lerato',
  birthYear = 2005,
): Promise<string> {
  const id = randomUUID();
  await db.withOrg(org.orgId, (tx) =>
    tx.execute(
      'INSERT INTO stride.athletes (id, org_id, first_name, last_name, birth_year, created_by) VALUES (@id, @org, @first, @last, @year, @by)',
      {
        id: [sql.UniqueIdentifier, id],
        org: [sql.UniqueIdentifier, org.orgId],
        first: [sql.NVarChar(100), firstName],
        last: [sql.NVarChar(100), 'Test'],
        year: [sql.SmallInt, birthYear],
        by: [sql.UniqueIdentifier, org.coachId],
      },
    ),
  );
  return id;
}
