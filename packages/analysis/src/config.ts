import type { AnalysisConfig } from '@stride/shared/analysisConfig';

/**
 * Bump whenever any algorithm or any value in `defaultConfig` changes. A test fingerprints the
 * configuration and fails until the version is bumped and the new fingerprint is recorded.
 */
export const ALGORITHM_VERSION = '0.1.0';

/**
 * Every threshold, cut-off, distance and weight used by the analysis, in one place.
 *
 * Values marked STARTING VALUE come from the specification and are expected to change after the
 * week 1 to 2 spike on the Samsung Galaxy S23 Ultra (1080p slow motion at 240 fps). Values
 * marked NOT IN SPEC were not given by the specification; they are proposed defaults, listed in
 * docs/decisions.md, and must also be tuned in the spike.
 */
export const defaultConfig: AnalysisConfig = deepFreeze({
  landmarks: {
    /** Visibility (0 to 1) below which a landmark sample is treated as missing. NOT IN SPEC. */
    minVisibility: 0.5,
    /** Visibility needed for a landmark to count towards the athlete box for ROI tracking. NOT IN SPEC. */
    confidentVisibility: 0.5,
  },

  clean: {
    /** Hampel filter half window in frames (window is 2 * 7 + 1 = 15 frames, 62 ms at 240 fps). NOT IN SPEC. */
    hampelHalfWindow: 7,
    /** Hampel threshold in robust standard deviations (MAD * 1.4826). NOT IN SPEC. */
    hampelSigmas: 3,
    /** Floor under the Hampel robust deviation, in pixels, so a still foot's first movement is not a "spike". NOT IN SPEC. */
    hampelMinScalePx: 2,
    /** Longest gap, in frames, filled by monotone cubic interpolation (42 ms at 240 fps). NOT IN SPEC. */
    maxGapFrames: 10,
    /**
     * Zero-phase Butterworth low-pass cut-off in Hz. Sprint keeps more of the fast foot motion.
     * On synthetic 240 fps data, 16 and 25 Hz balance event-timing bias against noise: higher
     * cut-offs break down at 3 px of landmark noise, lower ones delay initial contact more.
     * See docs/spike-report.md for the measurements. NOT IN SPEC.
     */
    lowPassHz: { sprint: 25, distance: 16 },
    /** Butterworth order of each pass. Forward plus backward doubles the effective order. NOT IN SPEC. */
    butterworthOrder: 2,
  },

  roi: {
    /** The crop is the previous frame's confident-landmark box enlarged by this share. STARTING VALUE (40 percent). */
    enlarge: 0.4,
    /** Minimum side of the square crop in full-frame pixels. STARTING VALUE. */
    minSizePx: 384,
    /** When no person is found, retry once with the coach's initial box enlarged by this share. STARTING VALUE (50 percent). */
    retryEnlarge: 0.5,
    /** Consecutive frames without a person before the job stops with tracking_lost (0.2 s at 240 fps). NOT IN SPEC. */
    maxConsecutiveMisses: 48,
    /** Crops are drawn at most this many pixels square before pose estimation, to bound work per frame. NOT IN SPEC. */
    maxCropDrawPx: 640,
  },

  timebase: {
    /** Container timestamps are used only when they imply at least this rate. STARTING VALUE (100 fps). */
    minContainerFps: 100,
    /** ...and when at most this share of intervals is irregular ("low jitter"). NOT IN SPEC. */
    maxContainerIrregularShare: 0.02,
    /** A declared frame rate outside this range is not plausible, so the time axis cannot be built. NOT IN SPEC. */
    declaredFps: { min: 24, max: 1000 },
  },

  orientation: {
    /** Minimum mid-hip travel, in leg lengths, needed to decide the direction of travel. NOT IN SPEC. */
    minTravelLegs: 0.5,
    /** Window over which mid-hip travel must be forward for the steady_direction check. NOT IN SPEC. */
    steadyWindowSec: 0.1,
  },

  sides: {
    /** Mean visibility difference between the left and right groups needed to call the near side. NOT IN SPEC. */
    visibilityMargin: 0.02,
    /** An ankle label swap is counted when swapping labels is cheaper by this many leg lengths. NOT IN SPEC. */
    swapJumpLeg: 0.25,
  },

  events: {
    /** Contact-point speed below which a frame can be stance, in leg lengths per second. STARTING VALUE. */
    stanceSpeedLegPerSec: 1.5,
    /** Contact-point height above the ground line below which a frame can be stance, in leg lengths. STARTING VALUE. */
    groundBandLeg: 0.06,
    /** Stance runs shorter than this are discarded. STARTING VALUE. */
    minStanceMs: 50,
    /** Stance runs longer than this are discarded. STARTING VALUE. */
    maxStanceMs: 400,
    /** Stance runs separated by fewer than this many frames are merged. STARTING VALUE (two frames). */
    mergeGapFrames: 2,
    /** Primary and secondary initial contacts agree when within this time. STARTING VALUE. */
    icToleranceMs: 25,
    /** Primary and secondary toe-offs agree when within this time. STARTING VALUE. */
    toToleranceMs: 35,
    /** RANSAC iterations for the ground line fit (deterministic, seeded). NOT IN SPEC. */
    groundRansacIterations: 200,
    /** A foot point is a ground-line inlier when within this many leg lengths of the line. NOT IN SPEC. */
    groundInlierLeg: 0.02,
    /** Share of the lowest foot points, per leg-length bin of x, used as ground candidates. NOT IN SPEC. */
    groundLowestShare: 0.2,
    /** Steepest ground line accepted in the image (side-on camera, roughly level). NOT IN SPEC. */
    groundMaxSlope: 0.25,
    /** Step or stride intervals longer than this multiple of the median are treated as missed events. NOT IN SPEC. */
    maxIntervalRatio: 1.6,
    /** Minimum time between two Zeni extrema of the same kind for one foot. NOT IN SPEC. */
    zeniMinSeparationMs: 150,
    /** Minimum prominence of a Zeni extremum, in leg lengths. NOT IN SPEC. */
    zeniProminenceLeg: 0.05,
  },

  metrics: {
    /** Metrics shown by mode, primary first. STARTING VALUE (spec table "Metrics shown by mode"). */
    byMode: {
      sprint: {
        primary: [
          'stride_frequency',
          'contact_time',
          'flight_time',
          'shin_angle_ic',
          'trunk_lean',
          'overstride',
        ],
        secondary: ['step_length', 'speed', 'knee_flexion_ic', 'arm_swing_range'],
      },
      distance: {
        primary: [
          'cadence',
          'overstride',
          'trunk_lean',
          'contact_asymmetry',
          'vertical_oscillation',
        ],
        secondary: ['contact_time', 'knee_flexion_ic', 'step_time_asymmetry', 'speed'],
      },
    },
    /** foot_angle_ic is experimental and off by default. No foot strike pattern is labelled in the MVP. */
    featureFlags: { footAngleIc: false },
    /** Capture rate below which no metric is considered adequately sampled. STARTING VALUE (matches the gate fail). */
    minFps: 100,
    /** contact_time and flight_time may be High only at or above this capture rate... STARTING VALUE. */
    timingHighFps: 200,
    /** ...and only when at least this share of events agree between the two methods. STARTING VALUE. */
    timingHighQe: 0.8,
    /** Analyse every Nth frame. Distance mode may use 2 (120 effective fps) if processing is too slow. STARTING VALUE. */
    frameStep: { sprint: 1, distance: 1 },
  },

  confidence: {
    /** High: Ql, Qe where events are needed, cycles per side, steps for whole-body metrics. STARTING VALUE. */
    high: { minQl: 0.9, minQe: 0.8, minPerSide: 3, minSteps: 4 },
    /** Medium. STARTING VALUE. */
    medium: { minQl: 0.75, minQe: 0.6, minN: 2 },
    /** Low. Anything below is unavailable. STARTING VALUE. */
    low: { minQl: 0.5, minN: 1 },
  },

  spread: {
    /** Standard deviation across cycles is returned when at least this many cycles were used. STARTING VALUE. */
    minN: 3,
  },

  calibration: {
    /** Default real distance between the two markers. STARTING VALUE (5.00 m). */
    defaultDistanceM: 5,
    /** Warn when the taps are closer than this share of the frame width. STARTING VALUE (20 percent). */
    minTapSeparationShare: 0.2,
    /** Warn when the vertical difference exceeds this share of the horizontal difference. STARTING VALUE (10 percent). */
    maxLevelRatio: 0.1,
    /**
     * Camera-stability signature size. The spec suggests 128 by 72; 256 by 144 is used because at
     * 1920 px wide one signature pixel is 7.5 full-resolution pixels, and the warn threshold is 6 px.
     * NOT IN SPEC (size changed from the example).
     */
    signatureWidth: 256,
    signatureHeight: 144,
  },

  gate: {
    /** Effective capture rate. STARTING VALUE. */
    fps: { warnSprintBelow: 200, failBelow: 100 },
    /** Interval irregularity: tolerance from the median, and the warn and fail shares. STARTING VALUE. */
    timing: { intervalTolerance: 0.25, warnShare: 0.02, failShare: 0.1 },
    /** Frame height in pixels. STARTING VALUE. */
    resolution: { warnHeightBelow: 1080, failHeightBelow: 720 },
    /** Clip length in seconds. STARTING VALUE. */
    durationSec: { min: 1, warnOver: 15, failOver: 30 },
    /** Camera shift in full-resolution pixels. STARTING VALUE. */
    cameraShiftPx: { warn: 6, fail: 15 },
    /** Share of frames with a pose. STARTING VALUE. */
    tracked: { warnBelow: 0.9, failBelow: 0.6 },
    /** Share of frames with near-side hip, knee and ankle visible. STARTING VALUE. */
    bodyVisible: { warnBelow: 0.85, failBelow: 0.5 },
    /** Median athlete height in pixels. STARTING VALUE. */
    athleteHeightPx: { warnBelow: 200, failBelow: 120 },
    /** Median visibility of heel and foot index. STARTING VALUE. */
    feetVisibility: { warnBelow: 0.6, failBelow: 0.4 },
    /** Share of the clip where the hip moves consistently forward. STARTING VALUE. */
    steadyDirection: { warnBelow: 0.85, failBelow: 0.6 },
    /** Initial contacts found, and the share of events breaking left-right alternation. STARTING VALUE. */
    events: { warnBelow: 4, failBelow: 2, alternateWarn: 0.1, alternateFail: 0.3 },
    /** Share of events where both detection methods agree. STARTING VALUE. */
    agreementWarnBelow: 0.6,
    /** Plausible cadence. Outside this range the frame rate is probably wrong. STARTING VALUE. */
    cadenceSpm: { min: 100, max: 330 },
  },
});

/** A mutable deep copy of the default configuration, for tuning in tests and the spike page. */
export function defaultAnalysisConfig(): AnalysisConfig {
  return JSON.parse(JSON.stringify(defaultConfig)) as AnalysisConfig;
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child as object);
  }
  return Object.freeze(value);
}
