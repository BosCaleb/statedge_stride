import { GATE_EFFECTS } from '@stride/analysis/gate';
import type { AnalysisResult, MetricResult } from '@stride/shared/analysisResult';
import type { Confidence, GateCheckId, MetricId } from '@stride/shared/enums';

// How metrics are shown: rounding (spec: cadence and times to whole numbers, angles to 0.1
// degrees, lengths to 0.01 m, percentages to 0.1), grouping by mode, and which warnings hid or
// lowered which metric.

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

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2, unavailable: 3 };

/** A metric with no value, or with the unavailable label, is not measured in this clip. */
export function isMeasured(m: MetricResult): boolean {
  return m.value !== null && m.confidence !== 'unavailable';
}

export interface MetricGroups {
  primary: MetricResult[];
  secondary: MetricResult[];
  /** Listed once with the reason, never shown as blank cards. */
  notMeasured: MetricResult[];
}

/** The metrics of the result's mode in two groups, higher confidence first. */
export function groupMetrics(result: AnalysisResult): MetricGroups {
  const lists = result.configSnapshot.metrics.byMode[result.mode];
  const byId = new Map(result.metrics.map((m) => [m.id, m]));
  const pick = (ids: readonly MetricId[]) =>
    ids.map((id) => byId.get(id)).filter((m): m is MetricResult => m !== undefined);
  const order = (list: MetricResult[]) =>
    list
      .map((m, i) => ({ m, i }))
      .sort((a, b) => RANK[a.m.confidence] - RANK[b.m.confidence] || a.i - b.i)
      .map(({ m }) => m);
  const primary = pick(lists.primary);
  const secondary = pick(lists.secondary);
  return {
    primary: order(primary.filter(isMeasured)),
    secondary: order(secondary.filter(isMeasured)),
    notMeasured: [...primary, ...secondary].filter((m) => !isMeasured(m)),
  };
}

export interface WarningEffect {
  check: GateCheckId;
  /** Shown metrics this warning hid. */
  hidden: MetricId[];
  /** Shown metrics whose second value (vertical oscillation in centimetres) it hid. */
  secondaryHidden: MetricId[];
  /** Shown metrics whose confidence this warning lowered. */
  lowered: MetricId[];
}

/** For a result that passed with conditions: each warning and the metrics it affected. */
export function warningEffects(result: AnalysisResult): WarningEffect[] {
  const shown = new Set<MetricId>([
    ...result.configSnapshot.metrics.byMode[result.mode].primary,
    ...result.configSnapshot.metrics.byMode[result.mode].secondary,
  ]);
  return result.gate.checks
    .filter((c) => c.level === 'warn')
    .map((c) => {
      const reason = `gate:${c.id}`;
      const affected = result.metrics.filter(
        (m) => shown.has(m.id) && m.reasons.some((r) => r === reason),
      );
      const effect = GATE_EFFECTS[c.id];
      const measured = affected.filter(isMeasured);
      const secondaryOnly = (m: MetricResult) =>
        (effect?.hideSecondary?.includes(m.id) ?? false) && !effect?.cap;
      return {
        check: c.id,
        hidden: affected.filter((m) => !isMeasured(m)).map((m) => m.id),
        secondaryHidden: measured
          .filter((m) => effect?.hideSecondary?.includes(m.id) && m.secondary?.value === null)
          .map((m) => m.id),
        lowered: measured.filter((m) => !secondaryOnly(m)).map((m) => m.id),
      };
    });
}
