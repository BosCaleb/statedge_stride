import type {
  Analysis,
  AnalysisPut,
  AnalysisSummary,
  HistoryEntry,
  MetricRow,
} from '@stride/shared/api/analyses';
import { analysisResultSchema, type MetricResult } from '@stride/shared/analysisResult';
import type { Mode } from '@stride/shared/enums';
import sql from 'mssql';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { isoDate, type Db } from '../lib/db';
import {
  METRIC_COLUMNS,
  NOTE_COLUMNS,
  SUMMARY_COLUMNS,
  toAnalysisSummary,
  toMetricRow,
  toNote,
} from './analyses';

// Saved analyses: the result JSON (immutable once written), one row per measured metric for
// history and trends, the keypoint file, and the history of an athlete. Queries are composed
// from constants only; lists of ids and metric rows travel as JSON parameters.

const byId = (id: string) => ({ id: [sql.UniqueIdentifier, id] as const });
const IN_IDS = '(SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))';

const SELECT_SUMMARY = `SELECT ${SUMMARY_COLUMNS} FROM stride.analyses a
  JOIN stride.clips c ON c.id = a.clip_id WHERE a.id = @id`;
const SELECT_FULL = `SELECT ${SUMMARY_COLUMNS}, a.result_json FROM stride.analyses a
  JOIN stride.clips c ON c.id = a.clip_id WHERE a.id = @id`;
const SELECT_NOTES = `SELECT ${NOTE_COLUMNS} FROM stride.notes WHERE analysis_id = @id ORDER BY created_at, id`;
const INSERT_ANALYSIS = `INSERT INTO stride.analyses
  (id, org_id, clip_id, athlete_id, algorithm_version, pose_model, gate_status, result_json, created_by)
  VALUES (@id, @org, @clip, @athlete, @algorithm, @pose, @gate, @result, @by)`;
const INSERT_METRICS = `INSERT INTO stride.analysis_metrics
  (analysis_id, org_id, metric_id, value, left_value, right_value, sd, n, unit, confidence)
  SELECT @id, @org, m.metric_id, m.value, m.left_value, m.right_value, m.sd, m.n, m.unit, m.confidence
  FROM OPENJSON(@rows) WITH (
    metric_id VARCHAR(40), value REAL, left_value REAL, right_value REAL, sd REAL,
    n SMALLINT, unit VARCHAR(16), confidence VARCHAR(12)) m`;
const SUPERSEDE = 'UPDATE stride.analyses SET superseded_by = @id WHERE id = @old';

export async function getAnalysisSummary(db: Db, id: string): Promise<AnalysisSummary | null> {
  const rows = await db.query<unknown>(SELECT_SUMMARY, byId(id));
  return rows[0] === undefined ? null : toAnalysisSummary(rows[0]);
}

export async function getAnalysis(db: Db, id: string): Promise<Analysis | null> {
  const rows = await db.query<{ result_json: string }>(SELECT_FULL, byId(id));
  const row = rows[0];
  if (!row) return null;
  return {
    ...toAnalysisSummary(row),
    result: analysisResultSchema.parse(JSON.parse(row.result_json)),
    notes: (await db.query<unknown>(SELECT_NOTES, byId(id))).map(toNote),
  };
}

/** The stored result, re-serialised through the schema so that key order is stable. */
export function canonicalResult(result: unknown): string {
  return JSON.stringify(analysisResultSchema.parse(result));
}

/** Measured metrics only: a hidden metric is not stored, shown or reported. */
export function metricRows(metrics: readonly MetricResult[]) {
  return metrics
    .filter((m) => m.value !== null && m.confidence !== 'unavailable')
    .map((m) => ({
      metric_id: m.id,
      value: m.value,
      left_value: m.bySide?.left ?? null,
      right_value: m.bySide?.right ?? null,
      sd: m.sd ?? null,
      n: Math.min(32767, m.n),
      unit: m.unit,
      confidence: m.confidence,
    }));
}

export async function insertAnalysis(
  db: Db,
  orgId: string,
  coachId: string,
  id: string,
  put: AnalysisPut,
): Promise<void> {
  const { result } = put;
  await db.execute(INSERT_ANALYSIS, {
    id: [sql.UniqueIdentifier, id],
    org: [sql.UniqueIdentifier, orgId],
    clip: [sql.UniqueIdentifier, put.clipId],
    athlete: [sql.UniqueIdentifier, put.athleteId],
    algorithm: [sql.VarChar(30), result.algorithmVersion],
    pose: [sql.VarChar(60), `${result.poseModel.id}@${result.poseModel.version}`],
    gate: [sql.VarChar(12), result.gate.status],
    result: [sql.NVarChar(sql.MAX), canonicalResult(result)],
    by: [sql.UniqueIdentifier, coachId],
  });
  const rows = metricRows(result.metrics);
  if (rows.length > 0) {
    await db.execute(INSERT_METRICS, {
      id: [sql.UniqueIdentifier, id],
      org: [sql.UniqueIdentifier, orgId],
      rows: [sql.NVarChar(sql.MAX), JSON.stringify(rows)],
    });
  }
  if (put.supersedes) {
    await db.execute(SUPERSEDE, {
      id: [sql.UniqueIdentifier, id],
      old: [sql.UniqueIdentifier, put.supersedes],
    });
  }
}

/** The stored result JSON and links of an analysis, for comparing a repeated write. */
export async function storedAnalysis(
  db: Db,
  id: string,
): Promise<{ clipId: string; athleteId: string; result: string } | null> {
  const rows = await db.query<{ result_json: string }>(SELECT_FULL, byId(id));
  const row = rows[0];
  if (!row) return null;
  const summary = toAnalysisSummary(row);
  return {
    clipId: summary.clipId,
    athleteId: summary.athleteId,
    result: canonicalResult(JSON.parse(row.result_json)),
  };
}

const SELECT_KEYPOINTS = 'SELECT keypoints FROM stride.analyses WHERE id = @id';
const SET_KEYPOINTS =
  'UPDATE stride.analyses SET keypoints = @bytes, keypoints_bytes = @length WHERE id = @id AND keypoints IS NULL';

/** The stored keypoint file: undefined when the analysis is not found, null when none is stored. */
export async function getKeypoints(db: Db, id: string): Promise<Uint8Array | null | undefined> {
  const rows = await db.query<{ keypoints: Buffer | null }>(SELECT_KEYPOINTS, byId(id));
  const row = rows[0];
  if (!row) return undefined;
  return row.keypoints ? new Uint8Array(row.keypoints) : null;
}

/** Stores the file once. Returns false when another write got there first. */
export async function setKeypoints(db: Db, id: string, bytes: Uint8Array): Promise<boolean> {
  const updated = await db.execute(SET_KEYPOINTS, {
    id: [sql.UniqueIdentifier, id],
    bytes: [sql.VarBinary(sql.MAX), Buffer.from(bytes)],
    length: [sql.Int, bytes.byteLength],
  });
  return updated > 0;
}

const DELETE_NOTES = 'DELETE FROM stride.notes WHERE analysis_id = @id';
const DELETE_METRICS = 'DELETE FROM stride.analysis_metrics WHERE analysis_id = @id';
const UNSUPERSEDE = 'UPDATE stride.analyses SET superseded_by = NULL WHERE superseded_by = @id';
const DELETE_ANALYSIS = 'DELETE FROM stride.analyses WHERE id = @id';

/** Deletes an analysis with its notes and metric rows. An analysis it replaced is current again. */
export async function deleteAnalysis(db: Db, id: string): Promise<boolean> {
  if (!(await getAnalysisSummary(db, id))) return false;
  await db.execute(DELETE_NOTES, byId(id));
  await db.execute(DELETE_METRICS, byId(id));
  await db.execute(UNSUPERSEDE, byId(id));
  return (await db.execute(DELETE_ANALYSIS, byId(id))) > 0;
}

const SELECT_HISTORY = `SELECT TOP (@take) ${SUMMARY_COLUMNS}, s.session_date
  FROM stride.analyses a
  JOIN stride.clips c ON c.id = a.clip_id
  JOIN stride.sessions s ON s.id = c.session_id
  WHERE a.athlete_id = @athlete AND a.superseded_by IS NULL
    AND (@mode IS NULL OR JSON_VALUE(a.result_json, '$.mode') = @mode)
    AND (@afterDate IS NULL
      OR s.session_date < @afterDate
      OR (s.session_date = @afterDate AND a.created_at < @afterCreated)
      OR (s.session_date = @afterDate AND a.created_at = @afterCreated AND a.id > @afterId))
  ORDER BY s.session_date DESC, a.created_at DESC, a.id`;
const SELECT_METRICS = `SELECT ${METRIC_COLUMNS} FROM stride.analysis_metrics WHERE analysis_id IN ${IN_IDS}`;

const historyCursor = z.tuple([z.iso.date(), z.iso.datetime(), z.guid()]);
const sessionDateRow = z.object({ session_date: z.date() });

/** An athlete's current analyses, newest session first, each with its metric rows. */
export async function athleteHistory(
  db: Db,
  athleteId: string,
  options: { limit: number; cursor?: string | undefined; mode?: Mode | undefined },
): Promise<{ items: HistoryEntry[]; nextCursor: string | null }> {
  const after = decodeCursor(options.cursor, historyCursor);
  const rows = await db.query<unknown>(SELECT_HISTORY, {
    take: [sql.Int, options.limit + 1],
    athlete: [sql.UniqueIdentifier, athleteId],
    mode: [sql.VarChar(10), options.mode ?? null],
    afterDate: [sql.Date, after?.[0] ?? null],
    afterCreated: [sql.DateTime2(0), after ? new Date(after[1]) : null],
    afterId: [sql.UniqueIdentifier, after?.[2] ?? null],
  });
  const page = rows.slice(0, options.limit).map((row) => ({
    ...toAnalysisSummary(row),
    sessionDate: isoDate(sessionDateRow.parse(row).session_date),
  }));
  const metrics = page.length
    ? (
        await db.query<unknown>(SELECT_METRICS, {
          ids: [sql.NVarChar(sql.MAX), JSON.stringify(page.map((p) => p.id))],
        })
      ).map(toMetricRow)
    : [];
  const byAnalysis = new Map<string, MetricRow[]>();
  for (const { analysisId, ...metric } of metrics) {
    const list = byAnalysis.get(analysisId) ?? [];
    list.push(metric);
    byAnalysis.set(analysisId, list);
  }
  const items = page.map((p) => ({ ...p, metrics: byAnalysis.get(p.id) ?? [] }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor([last.sessionDate, last.createdAt, last.id])
        : null,
  };
}
