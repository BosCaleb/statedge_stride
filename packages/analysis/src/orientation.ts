import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { Side } from '@stride/shared/enums';
import { distance } from './geometry';
import { linearFit, mean, median } from './stats';
import { LM, SIDE_LANDMARKS, type Point, type Track } from './types';

// Stage 3, step 5 (facing direction and mirroring) and side assignment.

export function landmarkAt(track: Track, landmark: number, k: number): Point | null {
  const x = track.x[landmark]?.[k] ?? NaN;
  const y = track.y[landmark]?.[k] ?? NaN;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Midpoint of a left and right landmark, or the one that is present. */
export function pairMidpoint(track: Track, left: number, right: number, k: number): Point | null {
  const a = landmarkAt(track, left, k);
  const b = landmarkAt(track, right, k);
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b;
}

export function midHip(track: Track, k: number): Point | null {
  return pairMidpoint(track, LM.leftHip, LM.rightHip, k);
}

export function midShoulder(track: Track, k: number): Point | null {
  return pairMidpoint(track, LM.leftShoulder, LM.rightShoulder, k);
}

/** Median over the clip of hip-to-knee plus knee-to-ankle on one side, in pixels. */
export function legLengthPx(track: Track, side: Side): number {
  const s = SIDE_LANDMARKS[side];
  const lengths: number[] = [];
  for (let k = 0; k < track.frameCount; k++) {
    const hip = landmarkAt(track, s.hip, k);
    const knee = landmarkAt(track, s.knee, k);
    const ankle = landmarkAt(track, s.ankle, k);
    if (hip && knee && ankle) lengths.push(distance(hip, knee) + distance(knee, ankle));
  }
  return median(lengths);
}

export interface TravelDirection {
  /** 1 when travel is left to right in the image. */
  direction: 1 | -1;
  /** False when the mid-hip moved too little to tell; direction then defaults to 1. */
  determined: boolean;
  slopePxPerSec: number;
}

/** Direction of travel from the sign of the slope of the mid-hip x series. */
export function travelDirection(
  track: Track,
  legLength: number,
  config: AnalysisConfig,
): TravelDirection {
  const xs = new Float64Array(track.frameCount).fill(NaN);
  for (let k = 0; k < track.frameCount; k++) xs[k] = midHip(track, k)?.x ?? NaN;
  const fit = linearFit(track.times, xs);
  if (!fit) return { direction: 1, determined: false, slopePxPerSec: 0 };
  let first = NaN;
  let last = NaN;
  for (let k = 0; k < track.frameCount; k++) {
    const t = track.times[k] ?? NaN;
    if (!Number.isFinite(xs[k] ?? NaN) || !Number.isFinite(t)) continue;
    if (Number.isNaN(first)) first = t;
    last = t;
  }
  const travel = Math.abs(fit.b * (last - first));
  const determined =
    Number.isFinite(legLength) && travel >= config.orientation.minTravelLegs * legLength;
  return { direction: fit.b < 0 ? -1 : 1, determined, slopePxPerSec: fit.b };
}

/** Mirrors x so that forward is always +x. Visibility and y are unchanged. */
export function mirrorTrack(track: Track): Track {
  const x = track.x.map((series) => {
    const out = new Float64Array(series.length);
    for (let k = 0; k < series.length; k++) out[k] = track.widthPx - (series[k] ?? NaN);
    return out;
  });
  return { ...track, x };
}

/**
 * Share of the clip where the mid-hip moves forward over a short window (analysis coordinates,
 * after mirroring). An athlete who stops or turns drives this down.
 */
export function steadyForwardShare(track: Track, config: AnalysisConfig): number {
  let forward = 0;
  let total = 0;
  let j = 0;
  for (let k = 0; k < track.frameCount; k++) {
    const tk = track.times[k] ?? NaN;
    const a = midHip(track, k);
    if (!a || !Number.isFinite(tk)) continue;
    if (j < k) j = k;
    while (
      j < track.frameCount &&
      (track.times[j] ?? Infinity) - tk < config.orientation.steadyWindowSec
    )
      j++;
    if (j >= track.frameCount) break;
    const b = midHip(track, j);
    if (!b) continue;
    total++;
    if (b.x > a.x) forward++;
  }
  return total === 0 ? 0 : forward / total;
}

function sideGroup(side: Side): number[] {
  const s = SIDE_LANDMARKS[side];
  return [s.shoulder, s.elbow, s.wrist, s.hip, s.knee, s.ankle, s.heel, s.footIndex];
}

const SIDE_GROUP: Record<Side, number[]> = { left: sideGroup('left'), right: sideGroup('right') };

/**
 * Counts frames where the left and right ankle tracks swap labels: keeping the labels would move
 * each ankle much further than swapping them would. Raw (uncleaned) positions are used.
 */
export function countAnkleSwaps(raw: Track, legLength: number, config: AnalysisConfig): number {
  if (!Number.isFinite(legLength)) return 0;
  const threshold = config.sides.swapJumpLeg * legLength;
  let swaps = 0;
  for (let k = 1; k < raw.frameCount; k++) {
    const l0 = landmarkAt(raw, LM.leftAnkle, k - 1);
    const r0 = landmarkAt(raw, LM.rightAnkle, k - 1);
    const l1 = landmarkAt(raw, LM.leftAnkle, k);
    const r1 = landmarkAt(raw, LM.rightAnkle, k);
    if (!l0 || !r0 || !l1 || !r1) continue;
    const keep = distance(l1, l0) + distance(r1, r0);
    const swap = distance(l1, r0) + distance(r1, l0);
    if (swap + threshold < keep) swaps++;
  }
  return swaps;
}

export interface SideAssessment {
  /** The side nearest the camera, from the direction of travel. */
  nearSide: Side;
  /** Side with the clearly higher mean visibility, or null when too close to call. */
  observedNear: Side | null;
  /** The visibility pattern does not match the direction of travel. */
  mismatch: boolean;
  ankleSwaps: number;
  /** Mismatch or swaps: per-side metrics are capped at low confidence. */
  uncertain: boolean;
  meanVisibility: Record<Side, number>;
}

/**
 * Side assignment. With a side-on camera, an athlete travelling left to right shows the camera
 * their right side; right to left shows the left side. The visibility of the left and right
 * landmark groups should agree with that, and the ankle labels should not swap mid-clip.
 */
export function assessSides(
  raw: Track,
  direction: 1 | -1,
  legLength: number,
  config: AnalysisConfig,
): SideAssessment {
  const nearSide: Side = direction === 1 ? 'right' : 'left';
  const meanVisibility = { left: NaN, right: NaN };
  for (const side of ['left', 'right'] as const) {
    const values: number[] = [];
    for (let k = 0; k < raw.frameCount; k++) {
      // Only frames where a pose was found.
      if (
        !Number.isFinite(raw.x[LM.nose]?.[k] ?? NaN) &&
        !Number.isFinite(raw.x[LM.leftHip]?.[k] ?? NaN)
      )
        continue;
      for (const l of SIDE_GROUP[side]) values.push(raw.v[l]?.[k] ?? 0);
    }
    meanVisibility[side] = mean(values);
  }
  const diff = meanVisibility.right - meanVisibility.left;
  const observedNear: Side | null =
    Math.abs(diff) > config.sides.visibilityMargin ? (diff > 0 ? 'right' : 'left') : null;
  const mismatch = observedNear !== nearSide;
  const ankleSwaps = countAnkleSwaps(raw, legLength, config);
  return {
    nearSide,
    observedNear,
    mismatch,
    ankleSwaps,
    uncertain: mismatch || ankleSwaps > 0,
    meanVisibility,
  };
}
