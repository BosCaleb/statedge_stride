import type { AnalysisSummary, MetricRow, Note } from '@stride/shared/api/analyses';
import {
  confidenceSchema,
  metricIdSchema,
  modeSchema,
  savedGateStatusSchema,
} from '@stride/shared/enums';
import { z } from 'zod';
import { guid } from '../lib/db';

// Row shapes and mappers for analyses, their metric rows and notes. The summary columns need
// the analysis joined to its clip (a) and clip (c).

export const SUMMARY_COLUMNS = `a.id, a.clip_id, a.athlete_id, c.session_id, JSON_VALUE(a.result_json, '$.mode') AS mode,
  a.algorithm_version, a.pose_model, a.gate_status, CAST(CASE WHEN a.keypoints_bytes IS NULL THEN 0 ELSE 1 END AS BIT) AS has_keypoints,
  a.created_by, a.created_at, a.superseded_by`;
const summaryRow = z.object({
  id: z.string(),
  clip_id: z.string(),
  athlete_id: z.string(),
  session_id: z.string(),
  mode: modeSchema,
  algorithm_version: z.string(),
  pose_model: z.string(),
  gate_status: savedGateStatusSchema,
  has_keypoints: z.boolean(),
  created_by: z.string(),
  created_at: z.date(),
  superseded_by: z.string().nullable(),
});

export function toAnalysisSummary(row: unknown): AnalysisSummary {
  const r = summaryRow.parse(row);
  return {
    id: guid(r.id),
    clipId: guid(r.clip_id),
    athleteId: guid(r.athlete_id),
    sessionId: guid(r.session_id),
    mode: r.mode,
    algorithmVersion: r.algorithm_version,
    poseModel: r.pose_model,
    gateStatus: r.gate_status,
    hasKeypoints: r.has_keypoints,
    createdBy: guid(r.created_by),
    createdAt: r.created_at.toISOString(),
    supersededBy: guid(r.superseded_by),
  };
}

export const METRIC_COLUMNS =
  'analysis_id, metric_id, value, left_value, right_value, sd, n, unit, confidence';
const metricRow = z.object({
  analysis_id: z.string(),
  metric_id: metricIdSchema,
  value: z.number().nullable(),
  left_value: z.number().nullable(),
  right_value: z.number().nullable(),
  sd: z.number().nullable(),
  n: z.number().int(),
  unit: z.string(),
  confidence: confidenceSchema,
});

export function toMetricRow(row: unknown): MetricRow & { analysisId: string } {
  const r = metricRow.parse(row);
  return {
    analysisId: guid(r.analysis_id),
    metricId: r.metric_id,
    value: r.value,
    left: r.left_value,
    right: r.right_value,
    sd: r.sd,
    n: r.n,
    unit: r.unit,
    confidence: r.confidence,
  };
}

export const NOTE_COLUMNS = 'id, analysis_id, coach_id, body, created_at, updated_at';
const noteRow = z.object({
  id: z.string(),
  analysis_id: z.string(),
  coach_id: z.string(),
  body: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export function toNote(row: unknown): Note {
  const r = noteRow.parse(row);
  return {
    id: guid(r.id),
    analysisId: guid(r.analysis_id),
    coachId: guid(r.coach_id),
    body: r.body,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
