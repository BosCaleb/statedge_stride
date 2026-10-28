import type { Session, SessionDetail, SessionPut } from '@stride/shared/api/sessions';
import sql from 'mssql';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import type { Db } from '../lib/db';
import { SUMMARY_COLUMNS, toAnalysisSummary } from './analyses';
import {
  CALIBRATION_COLUMNS,
  CLIP_COLUMNS,
  SESSION_COLUMNS,
  toCalibration,
  toClip,
  toSession,
} from './sessions';

// Sessions: one capture occasion. Last write wins. Listed newest first by date.

const SELECT_ONE = `SELECT ${SESSION_COLUMNS} FROM stride.sessions WHERE id = @id`;
const SELECT_PAGE = `SELECT TOP (@take) ${SESSION_COLUMNS} FROM stride.sessions s
  WHERE s.org_id = @org
    AND (@from IS NULL OR s.session_date >= @from)
    AND (@to IS NULL OR s.session_date <= @to)
    AND (@athlete IS NULL OR EXISTS (SELECT 1 FROM stride.clips c WHERE c.session_id = s.id AND c.athlete_id = @athlete))
    AND (@afterDate IS NULL
      OR s.session_date < @afterDate
      OR (s.session_date = @afterDate AND s.created_at < @afterCreated)
      OR (s.session_date = @afterDate AND s.created_at = @afterCreated AND s.id > @afterId))
  ORDER BY s.session_date DESC, s.created_at DESC, s.id`;
const CALIBRATIONS = `SELECT ${CALIBRATION_COLUMNS} FROM stride.calibrations WHERE session_id = @id ORDER BY created_at`;
const CLIPS = `SELECT ${CLIP_COLUMNS} FROM stride.clips WHERE session_id = @id ORDER BY created_at`;
const ANALYSES = `SELECT ${SUMMARY_COLUMNS} FROM stride.analyses a JOIN stride.clips c ON c.id = a.clip_id
  WHERE c.session_id = @id ORDER BY a.created_at`;

export async function getSession(db: Db, id: string): Promise<Session | null> {
  const rows = await db.query<unknown>(SELECT_ONE, { id: [sql.UniqueIdentifier, id] });
  return rows[0] === undefined ? null : toSession(rows[0]);
}

export async function sessionDetail(db: Db, id: string): Promise<SessionDetail | null> {
  const session = await getSession(db, id);
  if (!session) return null;
  const byId = { id: [sql.UniqueIdentifier, id] } as const;
  return {
    session,
    calibrations: (await db.query<unknown>(CALIBRATIONS, byId)).map(toCalibration),
    clips: (await db.query<unknown>(CLIPS, byId)).map(toClip),
    analyses: (await db.query<unknown>(ANALYSES, byId)).map(toAnalysisSummary),
  };
}

const cursorSchema = z.tuple([z.iso.date(), z.iso.datetime(), z.guid()]);

export async function listSessions(
  db: Db,
  orgId: string,
  options: {
    limit: number;
    cursor?: string | undefined;
    athleteId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<{ items: Session[]; nextCursor: string | null }> {
  const after = decodeCursor(options.cursor, cursorSchema);
  const rows = await db.query<unknown>(SELECT_PAGE, {
    take: [sql.Int, options.limit + 1],
    org: [sql.UniqueIdentifier, orgId],
    from: [sql.Date, options.from ?? null],
    to: [sql.Date, options.to ?? null],
    athlete: [sql.UniqueIdentifier, options.athleteId ?? null],
    afterDate: [sql.Date, after?.[0] ?? null],
    afterCreated: [sql.DateTime2(0), after ? new Date(after[1]) : null],
    afterId: [sql.UniqueIdentifier, after?.[2] ?? null],
  });
  const sessions = rows.map(toSession);
  const page = sessions.slice(0, options.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      sessions.length > options.limit && last
        ? encodeCursor([last.sessionDate, last.createdAt, last.id])
        : null,
  };
}

/** Inserts or updates. Returns true when the session was created. */
export async function upsertSession(
  db: Db,
  id: string,
  orgId: string,
  coachId: string,
  put: SessionPut,
): Promise<boolean> {
  const params = {
    id: [sql.UniqueIdentifier, id],
    date: [sql.Date, put.sessionDate],
    place: [sql.NVarChar(200), put.place ?? null],
    surface: [sql.VarChar(12), put.surface ?? null],
    footwear: [sql.NVarChar(100), put.footwear ?? null],
    mode: [sql.VarChar(10), put.mode],
    notes: [sql.NVarChar(1000), put.notes ?? null],
  } as const;
  const updated = await db.execute(
    `UPDATE stride.sessions SET session_date = @date, place = @place, surface = @surface, footwear = @footwear,
       mode = @mode, notes = @notes WHERE id = @id`,
    params,
  );
  if (updated > 0) return false;
  await db.execute(
    `INSERT INTO stride.sessions (id, org_id, created_by, session_date, place, surface, footwear, mode, notes)
     VALUES (@id, @org, @by, @date, @place, @surface, @footwear, @mode, @notes)`,
    { ...params, org: [sql.UniqueIdentifier, orgId], by: [sql.UniqueIdentifier, coachId] },
  );
  return true;
}
