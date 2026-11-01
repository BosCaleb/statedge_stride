import type { ReasonCode } from '@stride/shared/enums';
import { strings } from '../../lib/strings';

// Metric values and reasons in the coach's words. Rounding follows the spec: cadence and times
// to whole numbers, angles to 0.1 degrees, lengths to 0.01 m, percentages to 0.1. Kept apart
// from metricFormat.ts, which reads the analysis package, so that the report PDF and the public
// report can show values without loading analysis code.

const DECIMALS: Record<string, number> = {
  spm: 0,
  ms: 0,
  deg: 1,
  m: 2,
  'm/s': 2,
  Hz: 2,
  '%': 1,
  '%L': 1,
  cm: 1,
};

export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  const fixed = value.toFixed(DECIMALS[unit] ?? 1);
  // No "-0.0".
  return Number(fixed) === 0 ? (0).toFixed(DECIMALS[unit] ?? 1) : fixed;
}

export function unitLabel(unit: string): string {
  return (strings.metrics.units as Record<string, string>)[unit] ?? unit;
}

/** A reason code in the coach's words (gate:<check> uses that check's message). */
export function reasonText(code: ReasonCode): string {
  if (code.startsWith('gate:')) {
    const check = code.slice(5) as keyof typeof strings.gate.checks;
    return strings.gate.checks[check].message;
  }
  return strings.metrics.reasons[code as keyof typeof strings.metrics.reasons];
}
