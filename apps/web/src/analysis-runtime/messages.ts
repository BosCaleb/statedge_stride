import { analysisConfigSchema } from '@stride/shared/analysisConfig';
import { analysisResultSchema } from '@stride/shared/analysisResult';
import { failCodeSchema, modeSchema, stageSchema } from '@stride/shared/enums';
import { z } from 'zod';

// One typed union per direction, validated with zod on both sides of the worker boundary.
// Beyond the specification's start/cancel and progress/done/failed: `frame` and
// `end-of-frames` carry frames from the main-thread video-element decoder, and `pause` and
// `resume` follow the page's visibility.

const finite = z.number().finite();
const roiSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
});
const point = z.object({ x: finite, y: finite });

const isImageBitmap = (v: unknown): v is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;

export const calibrationInputSchema = z.object({
  markerA: point,
  markerB: point,
  distanceM: finite.positive(),
  pxPerM: finite.positive(),
  backgroundSignature: z.instanceof(Float32Array),
  signatureWidth: z.number().int().positive(),
  signatureHeight: z.number().int().positive(),
  /** Size of the calibration frame; a different size from the run clip cannot be compared. */
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
});
export type CalibrationInput = z.infer<typeof calibrationInputSchema>;

export const estimatorSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mediapipe'),
    variant: z.enum(['full', 'heavy']),
    delegate: z.enum(['GPU', 'CPU']),
  }),
  z.object({ kind: z.literal('fixture'), url: z.string() }),
]);
export type EstimatorSpec = z.infer<typeof estimatorSpecSchema>;

export const startMessageSchema = z.object({
  type: z.literal('start'),
  jobId: z.string(),
  file: z.instanceof(Blob),
  calibration: calibrationInputSchema.nullable(),
  roi: roiSchema,
  /** The decoded frame the coach drew the box on; analysis starts there. */
  roiFrame: z.number().int().nonnegative(),
  mode: modeSchema,
  declaredFps: finite.positive(),
  config: analysisConfigSchema,
  /** `external` means frames arrive as `frame` messages from the main thread. */
  decoder: z.enum(['webcodecs', 'external']),
  estimator: estimatorSpecSchema,
  createdAt: z.iso.datetime(),
});
export type StartMessage = z.infer<typeof startMessageSchema>;

export const toWorkerSchema = z.discriminatedUnion('type', [
  startMessageSchema,
  z.object({ type: z.literal('cancel'), jobId: z.string() }),
  z.object({ type: z.literal('pause'), jobId: z.string() }),
  z.object({ type: z.literal('resume'), jobId: z.string() }),
  z.object({
    type: z.literal('frame'),
    jobId: z.string(),
    index: z.number().int().nonnegative(),
    timeSec: finite,
    bitmap: z.custom<ImageBitmap>(isImageBitmap),
  }),
  z.object({
    type: z.literal('end-of-frames'),
    jobId: z.string(),
    droppedFrames: z.number().int(),
  }),
]);
export type ToWorker = z.infer<typeof toWorkerSchema>;

export const jobStatsSchema = z.object({
  decoder: z.enum(['webcodecs', 'video-element']),
  delegate: z.enum(['GPU', 'CPU', 'none']),
  framesAnalysed: z.number().int(),
  framesWithPose: z.number().int(),
  poseMsMedian: finite,
  poseMsTotal: finite,
  wallMs: finite,
  droppedFrames: z.number().int(),
  /** Why tracking stopped early: the athlete left the frame at the end of the pass. */
  stoppedAt: z.number().int().nullable(),
});
export type JobStats = z.infer<typeof jobStatsSchema>;

export const fromWorkerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    jobId: z.string(),
    stage: stageSchema,
    fraction: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('done'),
    jobId: z.string(),
    result: analysisResultSchema,
    /** Raw (uncleaned) landmarks in the SKP1 format, uncompressed. */
    keypoints: z.instanceof(ArrayBuffer),
    stats: jobStatsSchema,
  }),
  z.object({
    type: z.literal('failed'),
    jobId: z.string(),
    code: failCodeSchema,
    detail: z.string(),
  }),
  /** Back-pressure for the external decoder: the worker has finished with this frame. */
  z.object({ type: z.literal('consumed'), jobId: z.string(), index: z.number().int() }),
]);
export type FromWorker = z.infer<typeof fromWorkerSchema>;
