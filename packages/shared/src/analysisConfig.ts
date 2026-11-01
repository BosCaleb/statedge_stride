import { z } from 'zod';
import { metricIdSchema } from './enums';

// The shape of the tunable analysis configuration. The values, each with a comment, live in
// packages/analysis/src/config.ts. A copy of the values used is stored in every result
// (`configSnapshot`) so that the clean stage can be re-run later from the raw keypoints.

const warnFail = z.object({ warnBelow: z.number(), failBelow: z.number() });

export const gateConfigSchema = z.object({
  fps: z.object({ warnSprintBelow: z.number(), failBelow: z.number() }),
  timing: z.object({
    intervalTolerance: z.number(),
    warnShare: z.number(),
    failShare: z.number(),
  }),
  resolution: z.object({ warnHeightBelow: z.number(), failHeightBelow: z.number() }),
  durationSec: z.object({ min: z.number(), warnOver: z.number(), failOver: z.number() }),
  cameraShiftPx: z.object({ warn: z.number(), fail: z.number() }),
  tracked: warnFail,
  bodyVisible: warnFail,
  athleteHeightPx: warnFail,
  feetVisibility: warnFail,
  steadyDirection: warnFail,
  events: z.object({
    warnBelow: z.number(),
    failBelow: z.number(),
    alternateWarn: z.number(),
    alternateFail: z.number(),
  }),
  agreementWarnBelow: z.number(),
  cadenceSpm: z.object({ min: z.number(), max: z.number() }),
});
export type GateConfig = z.infer<typeof gateConfigSchema>;

const metricList = z.array(metricIdSchema);

export const analysisConfigSchema = z.object({
  landmarks: z.object({
    minVisibility: z.number(),
    confidentVisibility: z.number(),
  }),
  clean: z.object({
    hampelHalfWindow: z.number().int(),
    hampelSigmas: z.number(),
    hampelMinScalePx: z.number(),
    maxGapFrames: z.number().int(),
    lowPassHz: z.object({ sprint: z.number(), distance: z.number() }),
    butterworthOrder: z.number().int(),
  }),
  roi: z.object({
    enlarge: z.number(),
    minSizePx: z.number(),
    retryEnlarge: z.number(),
    maxConsecutiveMisses: z.number().int(),
    maxCropDrawPx: z.number().int(),
  }),
  timebase: z.object({
    minContainerFps: z.number(),
    maxContainerIrregularShare: z.number(),
    declaredFps: z.object({ min: z.number(), max: z.number() }),
  }),
  orientation: z.object({
    minTravelLegs: z.number(),
    steadyWindowSec: z.number(),
  }),
  sides: z.object({
    visibilityMargin: z.number(),
    swapJumpLeg: z.number(),
  }),
  events: z.object({
    stanceSpeedLegPerSec: z.number(),
    groundBandLeg: z.number(),
    minStanceMs: z.number(),
    minStepMs: z.number(),
    duplicateShareOfNeighbour: z.number(),
    maxStanceMs: z.number(),
    mergeGapFrames: z.number().int(),
    icToleranceMs: z.number(),
    toToleranceMs: z.number(),
    groundRansacIterations: z.number().int(),
    groundInlierLeg: z.number(),
    groundLowestShare: z.number(),
    groundMaxSlope: z.number(),
    maxIntervalRatio: z.number(),
    zeniMinSeparationMs: z.number(),
    zeniProminenceLeg: z.number(),
  }),
  metrics: z.object({
    byMode: z.object({
      sprint: z.object({ primary: metricList, secondary: metricList }),
      distance: z.object({ primary: metricList, secondary: metricList }),
    }),
    featureFlags: z.object({ footAngleIc: z.boolean() }),
    minFps: z.number(),
    timingHighFps: z.number(),
    timingHighQe: z.number(),
    frameStep: z.object({ sprint: z.number().int(), distance: z.number().int() }),
  }),
  confidence: z.object({
    high: z.object({
      minQl: z.number(),
      minQe: z.number(),
      minPerSide: z.number().int(),
      minSteps: z.number().int(),
    }),
    medium: z.object({ minQl: z.number(), minQe: z.number(), minN: z.number().int() }),
    low: z.object({ minQl: z.number(), minN: z.number().int() }),
  }),
  spread: z.object({ minN: z.number().int() }),
  calibration: z.object({
    defaultDistanceM: z.number(),
    minTapSeparationShare: z.number(),
    maxLevelRatio: z.number(),
    signatureWidth: z.number().int(),
    signatureHeight: z.number().int(),
  }),
  gate: gateConfigSchema,
  comparison: z.object({ sameScaleShare: z.number(), sameFrameRateShare: z.number() }),
  runnerDetection: z.object({
    samples: z.number().int().positive(),
    minScore: z.number(),
    minHeightShare: z.number(),
    edgeMarginShare: z.number(),
    staticIou: z.number(),
    staticShare: z.number(),
    padShare: z.number(),
    nearLargestShare: z.number(),
  }),
  poseModel: z.object({
    heavyMaxMsPerFrame: z.number(),
    benchmarkFrames: z.number().int().positive(),
  }),
});
export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;

/**
 * The configuration as stored in a result (`configSnapshot`). A result keeps the configuration of
 * the algorithm version that made it, so values added in later versions may be missing: the
 * comparison thresholds (0.1.1), the duplicate-contact values (0.1.2), runner detection and the
 * pose model choice (0.1.3).
 */
export const configSnapshotSchema = analysisConfigSchema.extend({
  events: analysisConfigSchema.shape.events.partial({
    minStepMs: true,
    duplicateShareOfNeighbour: true,
  }),
  comparison: analysisConfigSchema.shape.comparison.optional(),
  runnerDetection: analysisConfigSchema.shape.runnerDetection.optional(),
  poseModel: analysisConfigSchema.shape.poseModel.optional(),
});
export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;
