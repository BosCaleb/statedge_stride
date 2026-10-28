import { z } from 'zod';
import { metricResultSchema } from './analysisResult';
import {
  metricIdSchema,
  modeSchema,
  reasonCodeSchema,
  savedGateStatusSchema,
  surfaceSchema,
} from './enums';
import { LIMITS } from './limits';

// What a report stores and what a share link shows. Results only: never raw keypoints, the birth
// year, or a full name unless the coach chose the full-name style for the PDF. The public copy
// always uses the first name and last initial, set by the API from the athlete record.

export const REPORT_SNAPSHOT_VERSION = 1;

/** Why a comparison may mislead, shown next to the comparison table. */
export const COMPARISON_CAVEATS = [
  'mode_differs',
  'calibration_differs',
  'algorithm_differs',
  'frame_rate_differs',
] as const;
export const comparisonCaveatSchema = z.enum(COMPARISON_CAVEATS);
export type ComparisonCaveat = z.infer<typeof comparisonCaveatSchema>;

/**
 * A key frame of the report. `label` is a short machine label such as "left:ic" or
 * "frame:412" (stored as VARCHAR(30)); `caption` is the text under the frame.
 */
export const reportFrameSchema = z.object({
  ordinal: z.number().int().min(1).max(LIMITS.maxReportFrames),
  label: z.string().regex(/^[a-z0-9_:.-]{1,30}$/),
  caption: z.string().trim().max(120),
});
export type ReportFrame = z.infer<typeof reportFrameSchema>;

export const reportAnalysisSchema = z.object({
  id: z.guid(),
  createdAt: z.iso.datetime(),
  algorithmVersion: z.string().min(1).max(30),
  gateStatus: savedGateStatusSchema,
  /** The metrics shown, each with its confidence label. */
  metrics: z.array(metricResultSchema).max(40),
  /** Metrics not shown, each listed once under "Not measured in this clip" with its reasons. */
  hidden: z
    .array(z.object({ id: metricIdSchema, reasons: z.array(reasonCodeSchema).max(20) }))
    .max(40),
});
export type ReportAnalysis = z.infer<typeof reportAnalysisSchema>;

export const reportSnapshotSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SNAPSHOT_VERSION),
    title: z.string().trim().min(1).max(200),
    organisationName: z.string().max(200),
    athleteDisplayName: z.string().trim().min(1).max(201),
    session: z.object({
      date: z.iso.date(),
      place: z.string().max(200).optional(),
      mode: modeSchema,
      surface: surfaceSchema.optional(),
      footwear: z.string().max(100).optional(),
    }),
    /** One analysis, or two of the same athlete for a comparison (earlier first). */
    analyses: z.array(reportAnalysisSchema).min(1).max(2),
    comparison: z
      .object({
        baselineAnalysisId: z.guid(),
        laterAnalysisId: z.guid(),
        caveats: z.array(comparisonCaveatSchema),
      })
      .optional(),
    notes: z.array(z.object({ text: z.string().max(2000), createdAt: z.iso.datetime() })).max(50),
    frames: z.array(reportFrameSchema).max(LIMITS.maxReportFrames),
    generatedAt: z.iso.datetime(),
  })
  .superRefine((s, ctx) => {
    const ordinals = s.frames.map((f) => f.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
      ctx.addIssue({ code: 'custom', path: ['frames'], message: 'Frame ordinals must be unique' });
    }
    const ids = s.analyses.map((a) => a.id);
    if (s.comparison) {
      if (
        s.analyses.length !== 2 ||
        !ids.includes(s.comparison.baselineAnalysisId) ||
        !ids.includes(s.comparison.laterAnalysisId)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['comparison'],
          message: 'A comparison names the two analyses of the report',
        });
      }
    } else if (s.analyses.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['analyses'],
        message: 'Two analyses need a comparison',
      });
    }
  });
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;

/** First name and last initial, as every shared copy shows the athlete. */
export function shortDisplayName(firstName: string, lastName: string): string {
  const initial = Array.from(lastName.trim())[0];
  return initial ? `${firstName.trim()} ${initial.toUpperCase()}.` : firstName.trim();
}
