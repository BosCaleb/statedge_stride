import { z } from 'zod';
import { analysisResultSchema, type AnalysisResult } from '../analysisResult';
import { confidenceSchema, metricIdSchema, modeSchema, savedGateStatusSchema } from '../enums';
import { isPlausible, PLAUSIBLE_VERTICAL_OSCILLATION_CM } from '../plausibility';
import { idSchema, isoDateSchema, isoDateTimeSchema, pageOf, pageQuerySchema } from './common';

/**
 * Problems that make a result implausible: a duplicated metric, or a value outside the generous
 * physical ranges. Each comes with the path of the offending value.
 */
export function implausibleValues(
  result: AnalysisResult,
): { path: (string | number)[]; message: string }[] {
  const problems: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  result.metrics.forEach((m, i) => {
    if (seen.has(m.id))
      problems.push({ path: ['metrics', i, 'id'], message: `${m.id} appears twice` });
    seen.add(m.id);
    if (!isPlausible(m.id, m.value)) {
      problems.push({
        path: ['metrics', i, 'value'],
        message: `${m.id} is outside the plausible range`,
      });
    }
    for (const side of ['left', 'right'] as const) {
      if (!isPlausible(m.id, m.bySide?.[side])) {
        problems.push({
          path: ['metrics', i, 'bySide', side],
          message: `${m.id} is outside the plausible range`,
        });
      }
    }
    const cm = m.secondary?.value;
    if (m.id === 'vertical_oscillation' && cm !== undefined && cm !== null) {
      const [min, max] = PLAUSIBLE_VERTICAL_OSCILLATION_CM;
      if (cm < min || cm > max) {
        problems.push({
          path: ['metrics', i, 'secondary', 'value'],
          message: `${m.id} is outside the plausible range`,
        });
      }
    }
  });
  return problems;
}

/**
 * PUT /v1/analyses/{id}: immutable once written. The API also requires an active analysis
 * consent (from a guardian for a minor) and refuses a failed gate.
 */
export const analysisPutSchema = z
  .object({
    clipId: idSchema,
    athleteId: idSchema,
    result: analysisResultSchema,
    /** The earlier analysis of the same clip that this one replaces. */
    supersedes: idSchema.nullable().optional(),
  })
  .superRefine((body, ctx) => {
    for (const problem of implausibleValues(body.result)) {
      ctx.addIssue({ code: 'custom', path: ['result', ...problem.path], message: problem.message });
    }
  });
export type AnalysisPut = z.infer<typeof analysisPutSchema>;

export const analysisSummarySchema = z.object({
  id: idSchema,
  clipId: idSchema,
  athleteId: idSchema,
  sessionId: idSchema,
  mode: modeSchema,
  algorithmVersion: z.string(),
  poseModel: z.string(),
  gateStatus: savedGateStatusSchema,
  hasKeypoints: z.boolean(),
  createdBy: idSchema,
  createdAt: isoDateTimeSchema,
  supersededBy: idSchema.nullable(),
});
export type AnalysisSummary = z.infer<typeof analysisSummarySchema>;

/** PUT /v1/notes/{id}: create or update (last write wins). */
export const notePutSchema = z.object({
  analysisId: idSchema,
  body: z.string().trim().min(1).max(2000),
});
export type NotePut = z.infer<typeof notePutSchema>;

export const noteSchema = z.object({
  id: idSchema,
  analysisId: idSchema,
  coachId: idSchema,
  body: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Note = z.infer<typeof noteSchema>;

/** GET /v1/analyses/{id} */
export const analysisSchema = analysisSummarySchema.extend({
  result: analysisResultSchema,
  notes: z.array(noteSchema),
});
export type Analysis = z.infer<typeof analysisSchema>;

/** One row of stride.analysis_metrics. */
export const metricRowSchema = z.object({
  metricId: metricIdSchema,
  value: z.number().nullable(),
  left: z.number().nullable(),
  right: z.number().nullable(),
  sd: z.number().nullable(),
  n: z.number().int(),
  unit: z.string(),
  confidence: confidenceSchema,
});
export type MetricRow = z.infer<typeof metricRowSchema>;

/** GET /v1/athletes/{id}/analyses: newest first, superseded analyses left out. */
export const athleteAnalysesQuerySchema = pageQuerySchema.extend({ mode: modeSchema.optional() });
export const historyEntrySchema = analysisSummarySchema.extend({
  sessionDate: isoDateSchema,
  metrics: z.array(metricRowSchema),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const athleteAnalysesPageSchema = pageOf(historyEntrySchema);
