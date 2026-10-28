import { z } from 'zod';
import { clipRoleSchema, modeSchema, surfaceSchema } from '../enums';
import { analysisSummarySchema } from './analyses';
import {
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  pageOf,
  pageQuerySchema,
} from './common';

/** PUT /v1/sessions/{id}: create or update (last write wins). */
export const sessionPutSchema = z.object({
  sessionDate: isoDateSchema,
  place: optionalText(200),
  surface: surfaceSchema.nullable().optional(),
  footwear: optionalText(100),
  mode: modeSchema,
  notes: optionalText(1000),
});
export type SessionPut = z.infer<typeof sessionPutSchema>;

export const sessionSchema = z.object({
  id: idSchema,
  sessionDate: isoDateSchema,
  place: z.string().nullable(),
  surface: surfaceSchema.nullable(),
  footwear: z.string().nullable(),
  mode: modeSchema,
  notes: z.string().nullable(),
  createdBy: idSchema,
  createdAt: isoDateTimeSchema,
});
export type Session = z.infer<typeof sessionSchema>;

/** GET /v1/sessions. `athleteId` keeps the sessions with a clip of that athlete. */
export const sessionListQuerySchema = pageQuerySchema.extend({
  athleteId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export const sessionPageSchema = pageOf(sessionSchema);

const finite = z.number().finite();
const imagePoint = z.object({ x: finite.min(0).max(8192), y: finite.min(0).max(8192) });
const frameSize = z.number().int().min(16).max(8192);

/** PUT /v1/calibrations/{id}: immutable once written. */
export const calibrationPutSchema = z.object({
  sessionId: idSchema,
  /** Distance between the two markers. Stored as DECIMAL(6,3). */
  distanceM: finite.positive().max(100),
  markerA: imagePoint,
  markerB: imagePoint,
  pxPerM: finite.positive().max(100_000),
  frameWidth: frameSize,
  frameHeight: frameSize,
});
export type CalibrationPut = z.infer<typeof calibrationPutSchema>;

export const calibrationSchema = calibrationPutSchema.extend({
  id: idSchema,
  createdAt: isoDateTimeSchema,
});
export type Calibration = z.infer<typeof calibrationSchema>;

/** SHA-256 of the first megabyte of the file plus its size, in lower-case hex. */
export const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * PUT /v1/clips/{id}: clip metadata, immutable once written. The video itself stays on the
 * phone. A run clip names its athlete; a calibration clip has none.
 */
export const clipPutSchema = z
  .object({
    sessionId: idSchema,
    athleteId: idSchema.nullable(),
    role: clipRoleSchema,
    calibrationId: idSchema.nullable(),
    deviceModel: optionalText(100),
    /** Rounded to a whole number, as stored. */
    declaredFps: z.number().int().min(1).max(1000),
    detectedFps: finite.positive().max(2000).nullable(),
    widthPx: frameSize,
    heightPx: frameSize,
    frameCount: z.number().int().nonnegative().max(1_000_000),
    durationSec: finite.nonnegative().max(3600),
    codec: z.string().max(30).nullable(),
    /** 1 when travel is left to right in the image. Known once the clip is analysed. */
    direction: z.union([z.literal(1), z.literal(-1)]).nullable(),
    fingerprint: fingerprintSchema.nullable(),
  })
  .refine((c) => (c.role === 'run') === (c.athleteId !== null), {
    message: 'A run clip needs an athlete and a calibration clip has none',
    path: ['athleteId'],
  });
export type ClipPut = z.infer<typeof clipPutSchema>;

export const clipSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  athleteId: idSchema.nullable(),
  role: clipRoleSchema,
  calibrationId: idSchema.nullable(),
  deviceModel: z.string().nullable(),
  declaredFps: z.number().int(),
  detectedFps: z.number().nullable(),
  widthPx: z.number().int(),
  heightPx: z.number().int(),
  frameCount: z.number().int(),
  durationSec: z.number(),
  codec: z.string().nullable(),
  direction: z.union([z.literal(1), z.literal(-1)]).nullable(),
  fingerprint: fingerprintSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Clip = z.infer<typeof clipSchema>;

/** GET /v1/sessions/{id} */
export const sessionDetailSchema = z.object({
  session: sessionSchema,
  calibrations: z.array(calibrationSchema),
  clips: z.array(clipSchema),
  analyses: z.array(analysisSummarySchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
