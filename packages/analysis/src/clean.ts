import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { Mode } from '@stride/shared/enums';
import { hampel, lowPassSeries } from './filters';
import { fillGaps, maskByVisibility } from './gaps';
import { LANDMARK_COUNT, type PoseFrame, type Track } from './types';

/**
 * Builds the raw track (stage 2 output) on the analysed frame grid. Sample k is decoded frame
 * k * frameStep. Frames that were not decoded, or where no person was found, stay NaN with
 * visibility 0. `timesSec` holds the analysis time of every decoded frame.
 */
export function rawTrackFromFrames(
  frames: readonly PoseFrame[],
  decodedFrameCount: number,
  frameStep: number,
  timesSec: ArrayLike<number>,
  widthPx: number,
  heightPx: number,
): Track {
  const n = Math.ceil(decodedFrameCount / frameStep);
  const times = new Float64Array(n);
  for (let k = 0; k < n; k++) times[k] = timesSec[k * frameStep] ?? NaN;
  const x: Float64Array[] = [];
  const y: Float64Array[] = [];
  const v: Float64Array[] = [];
  for (let l = 0; l < LANDMARK_COUNT; l++) {
    x.push(new Float64Array(n).fill(NaN));
    y.push(new Float64Array(n).fill(NaN));
    v.push(new Float64Array(n));
  }
  for (const frame of frames) {
    if (frame.index % frameStep !== 0 || !frame.landmarks) continue;
    const k = frame.index / frameStep;
    if (k >= n) continue;
    for (let l = 0; l < LANDMARK_COUNT; l++) {
      const lm = frame.landmarks[l];
      if (!lm) continue;
      (x[l] as Float64Array)[k] = lm.x;
      (y[l] as Float64Array)[k] = lm.y;
      (v[l] as Float64Array)[k] = lm.v;
    }
  }
  return { frameCount: n, times, x, y, v, widthPx, heightPx };
}

/**
 * Stage 3, steps 1 to 4, for every landmark: mask low visibility, remove spikes (a spike in
 * either axis removes the sample), fill short gaps, then zero-phase low-pass. Step 5 (direction
 * of travel and mirroring) is in orientation.ts. Visibility stays raw.
 */
export function cleanTrack(
  raw: Track,
  config: AnalysisConfig,
  mode: Mode,
  sampleRateHz: number,
): Track {
  const c = config.clean;
  const cutoff = c.lowPassHz[mode];
  const x: Float64Array[] = [];
  const y: Float64Array[] = [];
  for (let l = 0; l < LANDMARK_COUNT; l++) {
    const vis = raw.v[l] as Float64Array;
    const mx = maskByVisibility(raw.x[l] as Float64Array, vis, config.landmarks.minVisibility);
    const my = maskByVisibility(raw.y[l] as Float64Array, vis, config.landmarks.minVisibility);
    const hx = hampel(mx, c.hampelHalfWindow, c.hampelSigmas, c.hampelMinScalePx);
    const hy = hampel(my, c.hampelHalfWindow, c.hampelSigmas, c.hampelMinScalePx);
    for (let k = 0; k < raw.frameCount; k++) {
      if (!Number.isFinite(hx[k] ?? NaN) || !Number.isFinite(hy[k] ?? NaN)) {
        hx[k] = NaN;
        hy[k] = NaN;
      }
    }
    const fx = fillGaps(hx, c.maxGapFrames).series;
    const fy = fillGaps(hy, c.maxGapFrames).series;
    x.push(lowPassSeries(fx, cutoff, sampleRateHz, c.butterworthOrder));
    y.push(lowPassSeries(fy, cutoff, sampleRateHz, c.butterworthOrder));
  }
  return { ...raw, x, y, v: raw.v };
}
