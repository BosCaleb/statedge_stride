import type { Athlete, AthletePut } from '@stride/shared/api/athletes';
import sql from 'mssql';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { guid, type Db } from '../lib/db';
import { activeConsents, emptySummary } from './consents';

// Athletes, ordered by last name then first name. Writes are last-write-wins (the spec's
// choice for the MVP, because one coach normally edits their own records).

const rowSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_year: z.number().int(),
  external_ref: z.string().nullable(),
  created_by: z.string(),
  created_at: z.date(),
});
export type AthleteRow = z.infer<typeof rowSchema>;

// Queries are composed from constants only, never from input.
const COLUMNS = 'id, first_name, last_name, birth_year, external_ref, created_by, created_at';
const SELECT_ONE = `SELECT ${COLUMNS} FROM stride.athletes WHERE id = @id`;
const SELECT_PAGE = `SELECT TOP (@take) ${COLUMNS} FROM stride.athletes
  WHERE org_id = @org
    AND (@q IS NULL OR first_name LIKE @q ESCAPE '\\' OR last_name LIKE @q ESCAPE '\\' OR external_ref LIKE @q ESCAPE '\\')
    AND (@last IS NULL
      OR last_name > @last
      OR (last_name = @last AND first_name > @first)
      OR (last_name = @last AND first_name = @first AND id > @after))
  ORDER BY last_name, first_name, id`;

export async function findAthlete(db: Db, id: string): Promise<AthleteRow | null> {
  const rows = await db.query<unknown>(SELECT_ONE, { id: [sql.UniqueIdentifier, id] });
  return rows[0] === undefined ? null : rowSchema.parse(rows[0]);
}

function toAthlete(r: AthleteRow, consents = emptySummary()): Athlete {
  return {
    id: guid(r.id),
    firstName: r.first_name,
    lastName: r.last_name,
    birthYear: r.birth_year,
    externalRef: r.external_ref,
    createdAt: r.created_at.toISOString(),
    consents,
  };
}

export async function getAthlete(db: Db, id: string): Promise<Athlete | null> {
  const row = await findAthlete(db, id);
  if (!row) return null;
  const consents = await activeConsents(db, [guid(row.id)]);
  return toAthlete(row, consents.get(guid(row.id)));
}

/** A LIKE pattern that matches the text anywhere, with its wildcards escaped. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;
}

export async function listAthletes(
  db: Db,
  orgId: string,
  options: { q?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<{ items: Athlete[]; nextCursor: string | null }> {
  const after = decodeCursor(options.cursor, z.tuple([z.string(), z.string(), z.guid()]));
  const rows = (
    await db.query<unknown>(SELECT_PAGE, {
      take: [sql.Int, options.limit + 1],
      org: [sql.UniqueIdentifier, orgId],
      q: [sql.NVarChar(210), options.q ? containsPattern(options.q) : null],
      last: [sql.NVarChar(100), after?.[0] ?? null],
      first: [sql.NVarChar(100), after?.[1] ?? null],
      after: [sql.UniqueIdentifier, after?.[2] ?? null],
    })
  ).map((r) => rowSchema.parse(r));
  const page = rows.slice(0, options.limit);
  const consents = await activeConsents(
    db,
    page.map((r) => guid(r.id)),
  );
  const last = page.at(-1);
  return {
    items: page.map((r) => toAthlete(r, consents.get(guid(r.id)))),
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor([last.last_name, last.first_name, guid(last.id)])
        : null,
  };
}

/** Inserts or updates. Returns true when the athlete was created. */
export async function upsertAthlete(
  db: Db,
  id: string,
  orgId: string,
  coachId: string,
  put: AthletePut,
): Promise<boolean> {
  const params = {
    id: [sql.UniqueIdentifier, id],
    first: [sql.NVarChar(100), put.firstName],
    last: [sql.NVarChar(100), put.lastName],
    year: [sql.SmallInt, put.birthYear],
    ref: [sql.NVarChar(50), put.externalRef ?? null],
  } as const;
  const updated = await db.execute(
    'UPDATE stride.athletes SET first_name = @first, last_name = @last, birth_year = @year, external_ref = @ref WHERE id = @id',
    params,
  );
  if (updated > 0) return false;
  await db.execute(
    `INSERT INTO stride.athletes (id, org_id, first_name, last_name, birth_year, external_ref, created_by)
     VALUES (@id, @org, @first, @last, @year, @ref, @by)`,
    { ...params, org: [sql.UniqueIdentifier, orgId], by: [sql.UniqueIdentifier, coachId] },
  );
  return true;
}

/** The typed confirmation must repeat the full name; case and extra spaces do not matter. */
export function confirmsName(row: AthleteRow, typed: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  return norm(typed) === norm(`${row.first_name} ${row.last_name}`);
}

/** Deletes everything held for the athlete, in one transaction, with an audit row. */
export async function deleteAthlete(db: Db, id: string, coachId: string): Promise<boolean> {
  const rows = await db.query<{ deleted: boolean }>(
    'EXEC stride.delete_athlete @athlete_id = @id, @coach_id = @coach',
    { id: [sql.UniqueIdentifier, id], coach: [sql.UniqueIdentifier, coachId] },
  );
  return rows[0]?.deleted === true;
}
