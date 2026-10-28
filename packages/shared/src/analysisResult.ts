import { z } from 'zod';
import { analysisConfigSchema } from './analysisConfig';
import {
  checkLevelSchema,
  confidenceSchema,
  gateCheckIdSchema,
  gateStatusSchema,
  metricIdSchema,
  modeSchema,
  reasonCodeSchema,
  sideSchema,
  stanceAgreementSchema,
} from './enums';

// Schemas for the result JSON that is stored in stride.analyses.result_json. The web app parses
// its own results with these, and the API re-validates every saved result with the same schemas.

export const RESULT_SCHEMA_VERSION = 1;

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite });

export const stanceEventSchema = z.object({
  side: sideSchema,
  icFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().nonnegative().nullable(),
  icTimeSec: finite,
  toTimeSec: finite.nullable(),
  agreement: stanceAgreementSchema,
});
export type StanceEvent = z.infer<typeof stanceEventSchema>;

export const metricResultSchema = z.object({
  id: metricIdSchema,
  value: finite.nullable(),
  unit: z.string().max(16),
  bySide: z.object({ left: finite.nullable(), right: finite.nullable() }).optional(),
  /** Standard deviation across cycles, present when at least three cycles were used. */
  sd: finite.nonnegative().optional(),
  /** Number of cycles or events used. */
  n: z.number().int().nonnegative(),
  confidence: confidenceSchema,
  reasons: z.array(reasonCodeSchema),
  /**
   * A second representation of the same quantity. Used by vertical_oscillation, whose primary
   * value is a percentage of leg length and whose secondary value is centimetres (needs
   * calibration, hidden without it).
   */
  secondary: z.object({ value: finite.nullable(), unit: z.string().max(16) }).optional(),
});
export type MetricResult = z.infer<typeof metricResultSchema>;

export const gateCheckSchema = z.object({
  id: gateCheckIdSchema,
  ok: z.boolean(),
  /** pass, warn or fail. `ok` is true only for pass. */
  level: checkLevelSchema,
  /** Short technical detail such as the measured value, for example "118 fps". */
  detail: z.string().max(200),
});
export type GateCheck = z.infer<typeof gateCheckSchema>;

export const gateResultSchema = z.object({
  status: gateStatusSchema,
  checks: z.array(gateCheckSchema),
  hiddenMetrics: z.array(metricIdSchema),
});
export type GateResult = z.infer<typeof gateResultSchema>;

export const clipSummarySchema = z.object({
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  frameCount: z.number().int().nonnegative(),
  declaredFps: finite.positive(),
  codec: z.string().max(60),
  durationSec: finite.nonnegative(),
});
export type ClipSummary = z.infer<typeof clipSummarySchema>;

export const calibrationSummarySchema = z.object({
  markerA: point,
  markerB: point,
  distanceM: finite.positive(),
  pxPerM: finite.positive(),
});
export type CalibrationSummary = z.infer<typeof calibrationSummarySchema>;

export const keyFramesSchema = z.object({
  side: sideSchema,
  icFrame: z.number().int().nonnegative(),
  midFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().nonnegative(),
});
export type KeyFrames = z.infer<typeof keyFramesSchema>;

export const analysisResultSchema = z.object({
  schemaVersion: z.literal(RESULT_SCHEMA_VERSION),
  /** Bumped whenever any algorithm or configuration value changes. */
  algorithmVersion: z.string().min(1).max(30),
  poseModel: z.object({ id: z.string().min(1).max(40), version: z.string().min(1).max(20) }),
  mode: modeSchema,
  clip: clipSummarySchema,
  captureFps: finite.positive(),
  /** Whether frame times came from the container timestamps or from index / declaredFps. */
  timebase: z.enum(['container', 'declared']),
  /** 1 analyses every frame. 2 analyses every second frame (the distance-mode speed lever). */
  frameStep: z.number().int().min(1).max(4),
  /** 1 when travel is left to right in the image. */
  direction: z.union([z.literal(1), z.literal(-1)]),
  /** Null when no calibration was available. Scaled metrics are then hidden. */
  calibration: calibrationSummarySchema.nullable(),
  events: z.array(stanceEventSchema),
  /** Initial contact, mid-stance and toe-off of one well-detected stance, for key frames. */
  keyFrames: keyFramesSchema.nullable(),
  metrics: z.array(metricResultSchema),
  gate: gateResultSchema,
  configSnapshot: analysisConfigSchema,
  createdAt: z.iso.datetime(),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
