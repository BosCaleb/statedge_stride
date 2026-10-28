import type { Side } from '@stride/shared/enums';

// Core types of the analysis engine. Persisted result types (MetricResult, GateResult,
// StanceEvent, AnalysisResult) are defined once, as zod schemas, in @stride/shared/analysisResult.

/** Landmark indices, in MediaPipe Pose order (left then right in each pair). */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const LANDMARK_COUNT = 33;

/** The landmarks of one body side. */
export interface SideLandmarks {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
  heel: number;
  footIndex: number;
}

export const SIDE_LANDMARKS: Record<Side, SideLandmarks> = {
  left: {
    shoulder: LM.leftShoulder,
    elbow: LM.leftElbow,
    wrist: LM.leftWrist,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
    heel: LM.leftHeel,
    footIndex: LM.leftFootIndex,
  },
  right: {
    shoulder: LM.rightShoulder,
    elbow: LM.rightElbow,
    wrist: LM.rightWrist,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
    heel: LM.rightHeel,
    footIndex: LM.rightFootIndex,
  },
};

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** x and y are full-frame pixels. v is visibility from 0 to 1. */
export interface Landmark {
  x: number;
  y: number;
  v: number;
}

export interface PoseFrame {
  /** Decoded frame index. */
  index: number;
  /** Time used for analysis. */
  tSec: number;
  /** 33 entries, null when no person was found. */
  landmarks: Landmark[] | null;
}

export interface ClipInfo {
  widthPx: number;
  heightPx: number;
  frameCount: number;
  /** Chosen by the coach or the device profile. */
  declaredFps: number;
  /** Timestamps as stored in the file. */
  containerTimesSec: Float64Array;
  codec: string;
  durationSec: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Calibration {
  markerA: Point;
  markerB: Point;
  /** Default 5. */
  distanceM: number;
  pxPerM: number;
  /** Small grayscale thumbnail for movement checks. */
  backgroundSignature: Float32Array;
}

/** An axis-aligned box in full-frame pixels. */
export interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Expected failures are returned, not thrown. */
export type Outcome<T, R = string> = { ok: true; value: T } | { ok: false; reason: R };

/**
 * Landmark series for a whole clip, one Float64Array per landmark and axis, indexed by frame.
 * Missing samples are NaN. After cleaning, coordinates are in analysis space: forward is +x
 * (mirrored when the athlete ran right to left) and y points down.
 */
export interface Track {
  frameCount: number;
  /** Analysis time of each frame, seconds from the first frame. */
  times: Float64Array;
  x: Float64Array[];
  y: Float64Array[];
  /** Raw visibility per landmark and frame, 0 when the landmark or the whole pose was missing. */
  v: Float64Array[];
  widthPx: number;
  heightPx: number;
}
