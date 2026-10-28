import { z } from 'zod';
import { LIMITS } from '../limits';
import { reportSnapshotSchema } from '../reportSnapshot';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * PUT /v1/reports/{id}: create or update (last write wins). The title is the snapshot's title.
 * Every analysis in the snapshot must belong to the athlete.
 */
export const reportPutSchema = z.object({
  athleteId: idSchema,
  snapshot: reportSnapshotSchema,
});
export type ReportPut = z.infer<typeof reportPutSchema>;

export const reportSchema = z.object({
  id: idSchema,
  athleteId: idSchema,
  title: z.string(),
  snapshot: reportSnapshotSchema,
  /** Ordinals of the key-frame images uploaded so far. */
  frameOrdinals: z.array(z.number().int()),
  /** The active public copy, if any. Its link was shown once, when it was created. */
  share: z.object({ createdAt: isoDateTimeSchema, expiresAt: isoDateTimeSchema }).nullable(),
  createdBy: idSchema,
  createdAt: isoDateTimeSchema,
});
export type Report = z.infer<typeof reportSchema>;

/** Path parameter of the frame routes. */
export const frameOrdinalSchema = z.coerce.number().int().min(1).max(LIMITS.maxReportFrames);

/**
 * POST /v1/reports/{id}/share: needs an active sharing consent. Creating a new link replaces
 * the report's previous public copy.
 */
export const shareCreateSchema = z.object({
  expiresInDays: z.number().int().min(1).max(LIMITS.shareMaxDays).default(LIMITS.shareDefaultDays),
});
export const shareCreatedSchema = z.object({
  /** https://<web-origin>/r/{token}. Shown once: only the token's hash is stored. */
  url: z.url(),
  expiresAt: isoDateTimeSchema,
});
export type ShareCreated = z.infer<typeof shareCreatedSchema>;

/** GET /v1/public/reports/{token} */
export const publicReportSchema = z.object({
  snapshot: reportSnapshotSchema,
  expiresAt: isoDateTimeSchema,
});
export type PublicReport = z.infer<typeof publicReportSchema>;
