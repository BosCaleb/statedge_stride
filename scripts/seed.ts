// pnpm seed: replaces the two seeded organisations in the local database with fresh test data
// (coaches for fake sign-in, athletes and consents), so that the app and the cross-organisation
// checks have something to work with. Local only.

import { DEV_IDENTITIES, DEV_ORGS } from '@stride/shared/devIdentities';
import sql from 'mssql';
import { createDatabase, type Db } from '../apps/api/src/lib/db';
import { scriptDbSettings } from '../apps/api/src/migrate';

const settings = scriptDbSettings();
if (!settings.local) throw new Error('pnpm seed runs against the local database only');

/** Every org-scoped table, children first, so that deletes respect the foreign keys. */
const DELETE_ORG = `
DELETE f FROM stride.shared_report_frames f JOIN stride.shared_reports s ON s.token_hash = f.token_hash WHERE s.org_id = @org;
DELETE FROM stride.shared_reports WHERE org_id = @org;
DELETE FROM stride.report_frames WHERE org_id = @org;
DELETE FROM stride.reports WHERE org_id = @org;
DELETE FROM stride.notes WHERE org_id = @org;
DELETE FROM stride.analysis_metrics WHERE org_id = @org;
DELETE FROM stride.analyses WHERE org_id = @org;
DELETE FROM stride.clips WHERE org_id = @org;
DELETE FROM stride.calibrations WHERE org_id = @org;
DELETE FROM stride.sessions WHERE org_id = @org;
DELETE FROM stride.consents WHERE org_id = @org;
DELETE FROM stride.athletes WHERE org_id = @org;
DELETE FROM stride.device_checks WHERE org_id = @org;
DELETE FROM stride.invites WHERE org_id = @org;
DELETE FROM stride.audit_log WHERE org_id = @org;
DELETE FROM stride.coaches WHERE org_id = @org;
DELETE FROM stride.organisations WHERE id = @org;`;

interface SeedAthlete {
  id: string;
  firstName: string;
  lastName: string;
  birthYear: number;
  /** Consent for analysis and sharing, or none. */
  consent: { givenBy: 'athlete' | 'guardian'; name: string; relationship?: string } | null;
}

const ATHLETES: Record<keyof typeof DEV_ORGS, SeedAthlete[]> = {
  a: [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      firstName: 'Lerato',
      lastName: 'Seedling',
      birthYear: 2011,
      consent: { givenBy: 'guardian', name: 'Grace Seedling', relationship: 'Mother' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      firstName: 'Johan',
      lastName: 'Testrun',
      birthYear: 2004,
      consent: { givenBy: 'athlete', name: 'Johan Testrun' },
    },
    {
      id: 'a1000000-0000-4000-8000-000000000003',
      firstName: 'Naledi',
      lastName: 'Noconsent',
      birthYear: 2012,
      consent: null,
    },
  ],
  b: [
    {
      id: 'b1000000-0000-4000-8000-000000000001',
      firstName: 'Bongani',
      lastName: 'Otherclub',
      birthYear: 1999,
      consent: { givenBy: 'athlete', name: 'Bongani Otherclub' },
    },
  ],
};

async function seedOrg(db: Db, key: keyof typeof DEV_ORGS): Promise<void> {
  const org = DEV_ORGS[key];
  const id = (value: string) => [sql.UniqueIdentifier, value] as const;
  await db.execute(DELETE_ORG, { org: id(org.id) });
  await db.execute(
    'INSERT INTO stride.organisations (id, name, type, max_coaches) VALUES (@id, @name, @type, @max)',
    {
      id: id(org.id),
      name: [sql.NVarChar(200), org.name],
      type: [sql.VarChar(10), org.type],
      max: [sql.Int, org.maxCoaches],
    },
  );
  const coaches = DEV_IDENTITIES.flatMap((p) =>
    p.coach?.org === key ? [{ ...p, coach: p.coach }] : [],
  );
  for (const person of coaches) {
    await db.execute(
      'INSERT INTO stride.coaches (id, org_id, entra_oid, email, display_name, role) VALUES (@id, @org, @oid, @email, @name, @role)',
      {
        id: id(person.coach.id),
        org: id(org.id),
        oid: id(person.oid),
        email: [sql.NVarChar(320), person.email],
        name: [sql.NVarChar(200), person.name],
        role: [sql.VarChar(10), person.coach.role],
      },
    );
  }
  const createdBy = coaches[0]?.coach.id;
  if (!createdBy) throw new Error(`no seeded coach for organisation ${key}`);
  for (const athlete of ATHLETES[key]) {
    await db.execute(
      'INSERT INTO stride.athletes (id, org_id, first_name, last_name, birth_year, created_by) VALUES (@id, @org, @first, @last, @year, @by)',
      {
        id: id(athlete.id),
        org: id(org.id),
        first: [sql.NVarChar(100), athlete.firstName],
        last: [sql.NVarChar(100), athlete.lastName],
        year: [sql.SmallInt, athlete.birthYear],
        by: id(createdBy),
      },
    );
    if (!athlete.consent) continue;
    for (const purpose of ['analysis', 'sharing'] as const) {
      await db.execute(
        `INSERT INTO stride.consents (id, org_id, athlete_id, purpose, given_by, given_by_name, relationship, evidence, given_on, recorded_by)
         VALUES (NEWID(), @org, @athlete, @purpose, @givenBy, @name, @relationship, 'paper_form', CAST(SYSUTCDATETIME() AS DATE), @by)`,
        {
          org: id(org.id),
          athlete: id(athlete.id),
          purpose: [sql.VarChar(12), purpose],
          givenBy: [sql.VarChar(10), athlete.consent.givenBy],
          name: [sql.NVarChar(200), athlete.consent.name],
          relationship: [sql.NVarChar(50), athlete.consent.relationship ?? null],
          by: id(createdBy),
        },
      );
    }
  }
  console.log(
    `seeded ${org.name}: ${coaches.length} coach(es), ${ATHLETES[key].length} athlete(s)`,
  );
}

const database = createDatabase(settings);
try {
  for (const key of Object.keys(DEV_ORGS) as (keyof typeof DEV_ORGS)[]) {
    await database.withOrg(DEV_ORGS[key].id, (db) => seedOrg(db, key));
  }
  await database.withoutOrg((db) =>
    db.execute(`DELETE FROM stride.device_profiles;
INSERT INTO stride.device_profiles (model, tier, max_slowmo, notes) VALUES
  (N'Samsung Galaxy S23 Ultra', 'A', N'240 fps at 1080p', N'Reference device'),
  (N'Apple iPhone 13', 'A', N'240 fps at 1080p', NULL),
  (N'Samsung Galaxy A54', 'B', N'120 fps at 1080p', N'Distance mode only');`),
  );
} finally {
  await database.close();
}
console.log('Sign in locally with fake auth as one of:');
for (const p of DEV_IDENTITIES)
  console.log(
    `  ${p.email}${p.coach ? ` (${p.coach.role}, ${DEV_ORGS[p.coach.org].name})` : ' (no organisation yet)'}`,
  );
