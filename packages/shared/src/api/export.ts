import { z } from 'zod';
import { analysisResultSchema } from '../analysisResult';
import { reportSnapshotSchema } from '../reportSnapshot';
import { analysisSummarySchema, metricRowSchema, noteSchema } from './analyses';
import { consentSchema } from './athletes';
import { idSchema, isoDateTimeSchema } from './common';
import { calibrationSchema, clipSchema, sessionSchema } from './sessions';

/**
 * GET /v1/athletes/{id}/export: everything held about one athlete, for a data access request.
 * Keypoint files are binary and listed by analysis; each can be downloaded from
 * GET /v1/analyses/{id}/keypoints.
 */
export const athleteExportSchema = z.object({
  exportedAt: isoDateTimeSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  athlete: z.object({
    id: idSchema,
    firstName: z.string(),
    lastName: z.string(),
    birthYear: z.number().int(),
    externalRef: z.string().nullable(),
    createdBy: idSchema,
    createdAt: isoDateTimeSchema,
  }),
  consents: z.array(consentSchema),
  sessions: z.array(sessionSchema),
  calibrations: z.array(calibrationSchema),
  clips: z.array(clipSchema),
  analyses: z.array(
    analysisSummarySchema.extend({
      result: analysisResultSchema,
      metrics: z.array(metricRowSchema),
    }),
  ),
  notes: z.array(noteSchema),
  reports: z.array(
    z.object({
      id: idSchema,
      title: z.string(),
      createdAt: isoDateTimeSchema,
      snapshot: reportSnapshotSchema,
    }),
  ),
  sharedReports: z.array(
    z.object({ reportId: idSchema, createdAt: isoDateTimeSchema, expiresAt: isoDateTimeSchema }),
  ),
});
export type AthleteExport = z.infer<typeof athleteExportSchema>;
