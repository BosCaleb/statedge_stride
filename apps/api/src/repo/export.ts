import type { AthleteExport } from '@stride/shared/api/export';
import { analysisResultSchema } from '@stride/shared/analysisResult';
import { reportSnapshotSchema } from '@stride/shared/reportSnapshot';
import sql from 'mssql';
import { z } from 'zod';
import { guid, type Db } from '../lib/db';
import {
  METRIC_COLUMNS,
  NOTE_COLUMNS,
  SUMMARY_COLUMNS,
  toAnalysisSummary,
  toMetricRow,
  toNote,
} from './analyses';
import { findAthlete } from './athletes';
import { consentHistory } from './consents';
import { loadOrganisation } from './org';
import {
  CALIBRATION_COLUMNS,
  CLIP_COLUMNS,
  SESSION_COLUMNS,
  toCalibration,
  toClip,
  toSession,
} from './sessions';

// Everything held about one athlete, for a data access request (GET /v1/athletes/{id}/export).
// Queries are composed from constants only.

const IN_IDS = '(SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))';
const CLIPS = `SELECT ${CLIP_COLUMNS} FROM stride.clips WHERE athlete_id = @athlete ORDER BY created_at`;
const SESSIONS = `SELECT ${SESSION_COLUMNS} FROM stride.sessions WHERE id IN ${IN_IDS} ORDER BY session_date`;
const CALIBRATIONS = `SELECT ${CALIBRATION_COLUMNS} FROM stride.calibrations WHERE id IN ${IN_IDS}`;
const ANALYSES = `SELECT ${SUMMARY_COLUMNS}, a.result_json
  FROM stride.analyses a JOIN stride.clips c ON c.id = a.clip_id
  WHERE a.athlete_id = @athlete ORDER BY a.created_at`;
const METRICS = `SELECT ${METRIC_COLUMNS} FROM stride.analysis_metrics WHERE analysis_id IN ${IN_IDS}`;
const NOTES = `SELECT ${NOTE_COLUMNS} FROM stride.notes WHERE analysis_id IN ${IN_IDS} ORDER BY created_at`;
const REPORTS =
  'SELECT id, title, created_at, snapshot_json FROM stride.reports WHERE athlete_id = @athlete ORDER BY created_at';
const SHARED = `SELECT report_id, created_at, expires_at FROM stride.shared_reports
  WHERE org_id = @org AND revoked_at IS NULL AND report_id IN ${IN_IDS}`;

const ids = (values: readonly string[]) => ({
  ids: [sql.NVarChar(sql.MAX), JSON.stringify(values)] as const,
});

export async function exportAthlete(
  db: Db,
  orgId: string,
  athleteId: string,
  now: Date,
): Promise<AthleteExport | null> {
  const athlete = await findAthlete(db, athleteId);
  if (!athlete) return null;
  const byAthlete = { athlete: [sql.UniqueIdentifier, athleteId] as const };
  const { organisation } = await loadOrganisation(db, orgId);
  const consents = await consentHistory(db, athleteId);
  const clips = (await db.query<unknown>(CLIPS, byAthlete)).map(toClip);
  const sessions = (
    await db.query<unknown>(SESSIONS, ids([...new Set(clips.map((c) => c.sessionId))]))
  ).map(toSession);
  const calibrationIds = [
    ...new Set(clips.flatMap((c) => (c.calibrationId ? [c.calibrationId] : []))),
  ];
  const calibrations = (await db.query<unknown>(CALIBRATIONS, ids(calibrationIds))).map(
    toCalibration,
  );
  const analysisRows = await db.query<{ result_json: string }>(ANALYSES, byAthlete);
  const analysisIds = analysisRows.map((r) => toAnalysisSummary(r).id);
  const metrics = (await db.query<unknown>(METRICS, ids(analysisIds))).map(toMetricRow);
  const notes = (await db.query<unknown>(NOTES, ids(analysisIds))).map(toNote);
  const reportRows = z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        created_at: z.date(),
        snapshot_json: z.string(),
      }),
    )
    .parse(await db.query<unknown>(REPORTS, byAthlete));
  const reportIds = reportRows.map((r) => guid(r.id));
  const shared = z
    .array(z.object({ report_id: z.string(), created_at: z.date(), expires_at: z.date() }))
    .parse(
      await db.query<unknown>(SHARED, { ...ids(reportIds), org: [sql.UniqueIdentifier, orgId] }),
    );

  return {
    exportedAt: now.toISOString(),
    organisation: { id: organisation.id, name: organisation.name },
    athlete: {
      id: guid(athlete.id),
      firstName: athlete.first_name,
      lastName: athlete.last_name,
      birthYear: athlete.birth_year,
      externalRef: athlete.external_ref,
      createdBy: guid(athlete.created_by),
      createdAt: athlete.created_at.toISOString(),
    },
    consents,
    sessions,
    calibrations,
    clips,
    analyses: analysisRows.map((row) => {
      const summary = toAnalysisSummary(row);
      return {
        ...summary,
        result: analysisResultSchema.parse(JSON.parse(row.result_json)),
        metrics: metrics
          .filter((m) => m.analysisId === summary.id)
          .map(({ analysisId: _a, ...m }) => m),
      };
    }),
    notes,
    reports: reportRows.map((r) => ({
      id: guid(r.id),
      title: r.title,
      createdAt: r.created_at.toISOString(),
      snapshot: reportSnapshotSchema.parse(JSON.parse(r.snapshot_json)),
    })),
    sharedReports: shared.map((s) => ({
      reportId: guid(s.report_id),
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
    })),
  };
}
