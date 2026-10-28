import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import { distance } from './geometry';
import type { Outcome, Point } from './types';

// Real-world scale from two marker taps on the calibration frame.

export type CalibrationWarning = 'taps_close' | 'taps_not_level';
export type CalibrationError = 'invalid_distance' | 'taps_identical';

export interface ScaleResult {
  pxPerM: number;
  pixelDistance: number;
  warnings: CalibrationWarning[];
}

/**
 * pxPerM is the pixel distance between the taps divided by the real distance in metres. Warns
 * when the taps are closer than the configured share of the frame width (the scale is then less
 * precise), and when they are not roughly level (the markers should be at the same height).
 */
export function computeScale(
  markerA: Point,
  markerB: Point,
  distanceM: number,
  frameWidthPx: number,
  config: AnalysisConfig,
): Outcome<ScaleResult, CalibrationError> {
  if (!(distanceM > 0) || !Number.isFinite(distanceM))
    return { ok: false, reason: 'invalid_distance' };
  const pixelDistance = distance(markerA, markerB);
  if (!(pixelDistance > 0)) return { ok: false, reason: 'taps_identical' };
  const warnings: CalibrationWarning[] = [];
  if (pixelDistance < config.calibration.minTapSeparationShare * frameWidthPx)
    warnings.push('taps_close');
  const dx = Math.abs(markerB.x - markerA.x);
  const dy = Math.abs(markerB.y - markerA.y);
  if (dy > config.calibration.maxLevelRatio * dx) warnings.push('taps_not_level');
  return { ok: true, value: { pxPerM: pixelDistance / distanceM, pixelDistance, warnings } };
}
