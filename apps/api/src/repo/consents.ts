import type { Consent, ConsentPut, ConsentSummary } from '@stride/shared/api/athletes';
import {
  consentEvidenceSchema,
  consentGiverSchema,
  consentPurposeSchema,
  type ConsentPurpose,
} from '@stride/shared/enums';
import sql from 'mssql';
import { z } from 'zod';
import { guid, isoDate, type Db } from '../lib/db';

// Consents are immutable once written; withdrawal only sets withdrawn_at. At most one active
// consent exists per athlete and purpose (unique filtered index UX_consents_active).

const rowSchema = z.object({
  id: z.string(),
  athlete_id: z.string(),
  purpose: consentPurposeSchema,
  given_by: consentGiverSchema,
  given_by_name: z.string(),
  relationship: z.string().nullable(),
  evidence: consentEvidenceSchema,
  given_on: z.date(),
  recorded_by: z.string(),
  recorded_at: z.date(),
  withdrawn_at: z.date().nullable(),
});

// Queries are composed from constants only, here at module level, never from input.
const COLUMNS =
  'id, athlete_id, purpose, given_by, given_by_name, relationship, evidence, given_on, recorded_by, recorded_at, withdrawn_at';
const SELECT_ACTIVE = `SELECT ${COLUMNS} FROM stride.consents
  WHERE withdrawn_at IS NULL
    AND athlete_id IN (SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`;
const SELECT_ONE = `SELECT ${COLUMNS} FROM stride.consents WHERE id = @id`;
const SELECT_HISTORY = `SELECT ${COLUMNS} FROM stride.consents WHERE athlete_id = @athlete ORDER BY recorded_at DESC, id`;

export function toConsent(row: unknown): Consent {
  const r = rowSchema.parse(row);
  return {
    id: guid(r.id),
    athleteId: guid(r.athlete_id),
    purpose: r.purpose,
    givenBy: r.given_by,
    givenByName: r.given_by_name,
    relationship: r.relationship,
    evidence: r.evidence,
    givenOn: isoDate(r.given_on),
    recordedBy: guid(r.recorded_by),
    recordedAt: r.recorded_at.toISOString(),
    withdrawnAt: r.withdrawn_at?.toISOString() ?? null,
  };
}

export function emptySummary(): ConsentSummary {
  return { analysis: null, sharing: null, clip_storage: null };
}

/** The active consent per purpose for each athlete. */
export async function activeConsents(
  db: Db,
  athleteIds: readonly string[],
): Promise<Map<string, ConsentSummary>> {
  const result = new Map<string, ConsentSummary>(athleteIds.map((id) => [id, emptySummary()]));
  if (athleteIds.length === 0) return result;
  const rows = await db.query<unknown>(SELECT_ACTIVE, {
    ids: [sql.NVarChar(sql.MAX), JSON.stringify(athleteIds)],
  });
  for (const row of rows) {
    const consent = toConsent(row);
    const summary = result.get(consent.athleteId);
    if (summary) summary[consent.purpose] = consent;
  }
  return result;
}

export async function activeConsent(
  db: Db,
  athleteId: string,
  purpose: ConsentPurpose,
): Promise<Consent | null> {
  const summary = (await activeConsents(db, [athleteId])).get(athleteId);
  return summary?.[purpose] ?? null;
}

export async function getConsent(db: Db, id: string): Promise<Consent | null> {
  const rows = await db.query<unknown>(SELECT_ONE, { id: [sql.UniqueIdentifier, id] });
  return rows[0] === undefined ? null : toConsent(rows[0]);
}

export async function consentHistory(db: Db, athleteId: string): Promise<Consent[]> {
  const rows = await db.query<unknown>(SELECT_HISTORY, {
    athlete: [sql.UniqueIdentifier, athleteId],
  });
  return rows.map(toConsent);
}

/** True when a stored consent says the same as a repeated request. */
export function sameConsent(stored: Consent, put: ConsentPut): boolean {
  return (
    stored.athleteId === put.athleteId &&
    stored.purpose === put.purpose &&
    stored.givenBy === put.givenBy &&
    stored.givenByName === put.givenByName &&
    (stored.relationship ?? null) === (put.relationship ?? null) &&
    stored.evidence === put.evidence &&
    stored.givenOn === put.givenOn
  );
}

export async function insertConsent(
  db: Db,
  id: string,
  orgId: string,
  coachId: string,
  put: ConsentPut,
): Promise<void> {
  await db.execute(
    `INSERT INTO stride.consents (id, org_id, athlete_id, purpose, given_by, given_by_name, relationship, evidence, given_on, recorded_by)
     VALUES (@id, @org, @athlete, @purpose, @givenBy, @name, @relationship, @evidence, @givenOn, @by)`,
    {
      id: [sql.UniqueIdentifier, id],
      org: [sql.UniqueIdentifier, orgId],
      athlete: [sql.UniqueIdentifier, put.athleteId],
      purpose: [sql.VarChar(12), put.purpose],
      givenBy: [sql.VarChar(10), put.givenBy],
      name: [sql.NVarChar(200), put.givenByName],
      relationship: [sql.NVarChar(50), put.relationship ?? null],
      evidence: [sql.VarChar(12), put.evidence],
      givenOn: [sql.Date, put.givenOn],
      by: [sql.UniqueIdentifier, coachId],
    },
  );
}

/** Sets withdrawn_at once; withdrawing again changes nothing. */
export async function withdrawConsent(db: Db, id: string): Promise<boolean> {
  const changed = await db.execute(
    'UPDATE stride.consents SET withdrawn_at = SYSUTCDATETIME() WHERE id = @id AND withdrawn_at IS NULL',
    { id: [sql.UniqueIdentifier, id] },
  );
  return changed > 0;
}
