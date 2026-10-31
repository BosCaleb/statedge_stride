import type { Report, ReportListItem } from '@stride/shared/api/reports';
import { LIMITS } from '@stride/shared/limits';
import { reportSnapshotSchema, type ReportSnapshot } from '@stride/shared/reportSnapshot';
import sql from 'mssql';
import { z } from 'zod';
import { guid, type Db } from '../lib/db';

// Reports, their key frames, and their public copies. A report and its frames are private to
// the organisation (row-level security). A public copy lives in shared_reports and
// shared_report_frames, which have no organisation predicate: they are reached by the hash of an
// unguessable token, so every query on them here also names the organisation explicitly.
// Queries are composed from constants only.

const rowSchema = z.object({
  id: z.string(),
  athlete_id: z.string(),
  title: z.string(),
  snapshot_json: z.string(),
  created_by: z.string(),
  created_at: z.date(),
});

const shareSchema = z.object({ report_id: z.string(), created_at: z.date(), expires_at: z.date() });

const COLUMNS = 'id, athlete_id, title, snapshot_json, created_by, created_at';
const SELECT_ONE = `SELECT ${COLUMNS} FROM stride.reports WHERE id = @id`;
const SELECT_FOR_ATHLETE = `SELECT TOP (@take) ${COLUMNS} FROM stride.reports
  WHERE athlete_id = @athlete ORDER BY created_at DESC, id DESC`;
const SELECT_ORDINALS =
  'SELECT ordinal FROM stride.report_frames WHERE report_id = @id ORDER BY ordinal';
/** Active public copies (at most one per report) of the reports in @ids. */
const SELECT_SHARES = `SELECT report_id, created_at, expires_at FROM stride.shared_reports
  WHERE org_id = @org AND revoked_at IS NULL AND expires_at > @now
    AND report_id IN (SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`;
const UPDATE_REPORT =
  'UPDATE stride.reports SET title = @title, snapshot_json = @snapshot WHERE id = @id';
const INSERT_REPORT = `INSERT INTO stride.reports (id, org_id, athlete_id, created_by, title, snapshot_json)
  VALUES (@id, @org, @athlete, @by, @title, @snapshot)`;
const UPSERT_FRAME = `UPDATE stride.report_frames SET jpeg = @jpeg, created_at = SYSUTCDATETIME()
  WHERE report_id = @id AND ordinal = @ordinal;
IF @@ROWCOUNT = 0
  INSERT INTO stride.report_frames (report_id, org_id, ordinal, jpeg) VALUES (@id, @org, @ordinal, @jpeg);`;
const DELETE_SHARES = `DELETE f FROM stride.shared_report_frames f
  JOIN stride.shared_reports s ON s.token_hash = f.token_hash
  WHERE s.org_id = @org AND s.report_id = @id;
DELETE FROM stride.shared_reports WHERE org_id = @org AND report_id = @id;`;
const INSERT_SHARE = `INSERT INTO stride.shared_reports (token_hash, report_id, org_id, snapshot_json, expires_at)
  VALUES (@hash, @id, @org, @snapshot, @expires)`;
const COPY_FRAME = `INSERT INTO stride.shared_report_frames (token_hash, ordinal, label, jpeg)
  SELECT @hash, ordinal, @label, jpeg FROM stride.report_frames
  WHERE report_id = @id AND ordinal = @ordinal`;
const SELECT_PUBLIC = `SELECT snapshot_json, expires_at FROM stride.shared_reports
  WHERE token_hash = @hash AND revoked_at IS NULL AND expires_at > @now`;
const SELECT_PUBLIC_FRAME = `SELECT f.jpeg FROM stride.shared_report_frames f
  JOIN stride.shared_reports s ON s.token_hash = f.token_hash
  WHERE f.token_hash = @hash AND f.ordinal = @ordinal AND s.revoked_at IS NULL AND s.expires_at > @now`;

const byId = (id: string) => ({ id: [sql.UniqueIdentifier, id] as const });

export interface StoredReport {
  id: string;
  athleteId: string;
  title: string;
  snapshot: ReportSnapshot;
  createdBy: string;
  createdAt: Date;
}

function toStored(row: unknown): StoredReport {
  const r = rowSchema.parse(row);
  return {
    id: guid(r.id),
    athleteId: guid(r.athlete_id),
    title: r.title,
    snapshot: reportSnapshotSchema.parse(JSON.parse(r.snapshot_json)),
    createdBy: guid(r.created_by),
    createdAt: r.created_at,
  };
}

export async function findReport(db: Db, id: string): Promise<StoredReport | null> {
  const rows = await db.query<unknown>(SELECT_ONE, byId(id));
  return rows[0] === undefined ? null : toStored(rows[0]);
}

type Share = Report['share'];

async function activeShares(
  db: Db,
  orgId: string,
  reportIds: readonly string[],
  now: Date,
): Promise<Map<string, NonNullable<Share>>> {
  const result = new Map<string, NonNullable<Share>>();
  if (reportIds.length === 0) return result;
  const rows = await db.query<unknown>(SELECT_SHARES, {
    org: [sql.UniqueIdentifier, orgId],
    now: [sql.DateTime2(0), now],
    ids: [sql.NVarChar(sql.MAX), JSON.stringify(reportIds)],
  });
  for (const row of rows) {
    const s = shareSchema.parse(row);
    result.set(guid(s.report_id), {
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
    });
  }
  return result;
}

export async function frameOrdinals(db: Db, id: string): Promise<number[]> {
  const rows = await db.query<{ ordinal: number }>(SELECT_ORDINALS, byId(id));
  return rows.map((r) => r.ordinal);
}

export async function getReport(
  db: Db,
  orgId: string,
  id: string,
  now: Date,
): Promise<Report | null> {
  const stored = await findReport(db, id);
  if (!stored) return null;
  const shares = await activeShares(db, orgId, [stored.id], now);
  return {
    id: stored.id,
    athleteId: stored.athleteId,
    title: stored.title,
    snapshot: stored.snapshot,
    frameOrdinals: await frameOrdinals(db, id),
    share: shares.get(stored.id) ?? null,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt.toISOString(),
  };
}

/** Creates or updates (last write wins). Returns whether the report is new. */
export async function upsertReport(
  db: Db,
  input: {
    orgId: string;
    coachId: string;
    id: string;
    athleteId: string;
    snapshot: ReportSnapshot;
  },
): Promise<boolean> {
  const params = {
    id: [sql.UniqueIdentifier, input.id],
    title: [sql.NVarChar(200), input.snapshot.title],
    snapshot: [sql.NVarChar(sql.MAX), JSON.stringify(input.snapshot)],
  } as const;
  if ((await db.execute(UPDATE_REPORT, params)) > 0) return false;
  await db.execute(INSERT_REPORT, {
    ...params,
    org: [sql.UniqueIdentifier, input.orgId],
    athlete: [sql.UniqueIdentifier, input.athleteId],
    by: [sql.UniqueIdentifier, input.coachId],
  });
  return true;
}

/** Writes a key frame. Returns whether it is new. */
export async function putFrame(
  db: Db,
  orgId: string,
  id: string,
  ordinal: number,
  jpeg: Uint8Array,
): Promise<boolean> {
  const before = await frameOrdinals(db, id);
  await db.execute(UPSERT_FRAME, {
    id: [sql.UniqueIdentifier, id],
    org: [sql.UniqueIdentifier, orgId],
    ordinal: [sql.TinyInt, ordinal],
    jpeg: [sql.VarBinary(sql.MAX), Buffer.from(jpeg)],
  });
  return !before.includes(ordinal);
}

export async function listAthleteReports(
  db: Db,
  orgId: string,
  athleteId: string,
  now: Date,
): Promise<ReportListItem[]> {
  const rows = (
    await db.query<unknown>(SELECT_FOR_ATHLETE, {
      athlete: [sql.UniqueIdentifier, athleteId],
      take: [sql.Int, LIMITS.athleteReportList],
    })
  ).map(toStored);
  const shares = await activeShares(
    db,
    orgId,
    rows.map((r) => r.id),
    now,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    share: shares.get(r.id) ?? null,
    createdAt: r.createdAt.toISOString(),
    analysisIds: r.snapshot.analyses.map((a) => a.id),
    mode: r.snapshot.session.mode,
    sessionDate: r.snapshot.session.date,
  }));
}

/** Deletes the report's public copy and its frames. Returns whether there was one. */
export async function deleteShares(db: Db, orgId: string, id: string): Promise<boolean> {
  return (
    (await db.execute(DELETE_SHARES, {
      org: [sql.UniqueIdentifier, orgId],
      id: [sql.UniqueIdentifier, id],
    })) > 0
  );
}

/** Replaces the report's public copy with a new one, its frames copied from the report's. */
export async function insertShare(
  db: Db,
  input: {
    orgId: string;
    id: string;
    hash: Buffer;
    snapshot: ReportSnapshot;
    expiresAt: Date;
  },
): Promise<void> {
  await deleteShares(db, input.orgId, input.id);
  const ids = {
    hash: [sql.VarBinary(32), input.hash],
    id: [sql.UniqueIdentifier, input.id],
  } as const;
  await db.execute(INSERT_SHARE, {
    ...ids,
    org: [sql.UniqueIdentifier, input.orgId],
    snapshot: [sql.NVarChar(sql.MAX), JSON.stringify(input.snapshot)],
    expires: [sql.DateTime2(0), input.expiresAt],
  });
  for (const frame of input.snapshot.frames) {
    await db.execute(COPY_FRAME, {
      ...ids,
      ordinal: [sql.TinyInt, frame.ordinal],
      label: [sql.VarChar(30), frame.label],
    });
  }
}

export async function publicReport(
  db: Db,
  hash: Buffer,
  now: Date,
): Promise<{ snapshot: ReportSnapshot; expiresAt: Date } | null> {
  const rows = await db.query<{ snapshot_json: string; expires_at: Date }>(SELECT_PUBLIC, {
    hash: [sql.VarBinary(32), hash],
    now: [sql.DateTime2(0), now],
  });
  const row = rows[0];
  if (!row) return null;
  return {
    snapshot: reportSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
    expiresAt: row.expires_at,
  };
}

export async function publicFrame(
  db: Db,
  hash: Buffer,
  ordinal: number,
  now: Date,
): Promise<Uint8Array | null> {
  const rows = await db.query<{ jpeg: Buffer }>(SELECT_PUBLIC_FRAME, {
    hash: [sql.VarBinary(32), hash],
    ordinal: [sql.TinyInt, ordinal],
    now: [sql.DateTime2(0), now],
  });
  const row = rows[0];
  return row ? new Uint8Array(row.jpeg) : null;
}
