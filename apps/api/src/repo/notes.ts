import type { Note, NotePut } from '@stride/shared/api/analyses';
import sql from 'mssql';
import type { Db } from '../lib/db';
import { NOTE_COLUMNS, toNote } from './analyses';

// Coach notes on an analysis: last write wins. The coach who wrote a note first stays its author.

const byId = (id: string) => ({ id: [sql.UniqueIdentifier, id] as const });
const SELECT_NOTE = `SELECT ${NOTE_COLUMNS} FROM stride.notes WHERE id = @id`;
const UPDATE_NOTE =
  'UPDATE stride.notes SET body = @body, updated_at = SYSUTCDATETIME() WHERE id = @id AND analysis_id = @analysis';
const INSERT_NOTE = `INSERT INTO stride.notes (id, org_id, analysis_id, coach_id, body)
  VALUES (@id, @org, @analysis, @coach, @body)`;
const DELETE_NOTE = 'DELETE FROM stride.notes WHERE id = @id';

export async function getNote(db: Db, id: string): Promise<Note | null> {
  const rows = await db.query<unknown>(SELECT_NOTE, byId(id));
  return rows[0] === undefined ? null : toNote(rows[0]);
}

/** Creates or updates. Returns null when the note exists on another analysis. */
export async function upsertNote(
  db: Db,
  orgId: string,
  coachId: string,
  id: string,
  put: NotePut,
): Promise<{ created: boolean; note: Note } | null> {
  const params = {
    id: [sql.UniqueIdentifier, id],
    analysis: [sql.UniqueIdentifier, put.analysisId],
    body: [sql.NVarChar(2000), put.body],
  } as const;
  const existing = await getNote(db, id);
  if (existing && existing.analysisId !== put.analysisId) return null;
  if (existing) {
    await db.execute(UPDATE_NOTE, params);
  } else {
    await db.execute(INSERT_NOTE, {
      ...params,
      org: [sql.UniqueIdentifier, orgId],
      coach: [sql.UniqueIdentifier, coachId],
    });
  }
  const note = await getNote(db, id);
  if (!note) throw new Error('note not visible after write');
  return { created: !existing, note };
}

export async function deleteNote(db: Db, id: string): Promise<boolean> {
  return (await db.execute(DELETE_NOTE, byId(id))) > 0;
}
