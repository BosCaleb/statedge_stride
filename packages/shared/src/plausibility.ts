import type { MetricId } from './enums';

/**
 * Generous physical ranges. The API rejects a saved result with a value outside them: such a
 * number is a bug or a tampered result, never a real measurement.
 */
export const PLAUSIBLE_RANGES: Record<MetricId, readonly [number, number]> = {
  cadence: [60, 400],
  stride_frequency: [0.5, 3.5],
  contact_time: [30, 600],
  flight_time: [-200, 500],
  step_length: [0.2, 3.5],
  stride_length: [0.4, 7],
  speed: [0.5, 13],
  overstride: [-60, 120],
  shin_angle_ic: [-60, 60],
  knee_flexion_ic: [-20, 120],
  hip_flexion_ic: [-60, 150],
  trunk_lean: [-45, 60],
  vertical_oscillation: [0, 60],
  contact_asymmetry: [0, 100],
  step_time_asymmetry: [0, 100],
  arm_swing_range: [0, 180],
  foot_angle_ic: [-60, 60],
};

/** vertical_oscillation's secondary value in centimetres. */
export const PLAUSIBLE_VERTICAL_OSCILLATION_CM: readonly [number, number] = [0, 40];

export function isPlausible(id: MetricId, value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const [min, max] = PLAUSIBLE_RANGES[id];
  return Number.isFinite(value) && value >= min && value <= max;
}
