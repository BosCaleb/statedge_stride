import { defaultConfig } from '@stride/analysis/config';
import type { AnalysisResult, MetricResult } from '@stride/shared/analysisResult';
import type { MetricId } from '@stride/shared/enums';
import type { ComparisonCaveat } from '@stride/shared/reportSnapshot';
import { formatValue, isMeasured } from '../results/metricFormat';

// Comparing two analyses of one athlete: the change in each measurement, and why the comparison
// may mislead. The thresholds (analysis config) decide only what the coach is warned about.

const { sameScaleShare, sameFrameRateShare } = defaultConfig.comparison;

const differs = (a: number, b: number, share: number) =>
  Math.abs(a - b) > share * Math.max(Math.abs(a), Math.abs(b));

export function comparisonCaveats(
  before: AnalysisResult,
  after: AnalysisResult,
): ComparisonCaveat[] {
  const caveats: ComparisonCaveat[] = [];
  if (before.mode !== after.mode) caveats.push('mode_differs');
  const a = before.calibration;
  const b = after.calibration;
  if (!a || !b || differs(a.pxPerM, b.pxPerM, sameScaleShare) || a.distanceM !== b.distanceM)
    caveats.push('calibration_differs');
  if (before.algorithmVersion !== after.algorithmVersion) caveats.push('algorithm_differs');
  if (differs(before.captureFps, after.captureFps, sameFrameRateShare))
    caveats.push('frame_rate_differs');
  return caveats;
}

export interface MetricChange {
  id: MetricId;
  unit: string;
  before: MetricResult | null;
  after: MetricResult | null;
  /** After minus before, when both were measured. */
  change: number | null;
  /** Neutral words only: the app does not judge a change as better or worse. */
  direction: 'higher' | 'lower' | 'same' | null;
}

/** Every measurement shown in the later analysis's mode, in its order. */
export function metricChanges(before: AnalysisResult, after: AnalysisResult): MetricChange[] {
  const lists = after.configSnapshot.metrics.byMode[after.mode];
  const ids = [...lists.primary, ...lists.secondary];
  const find = (r: AnalysisResult, id: MetricId) => {
    const m = r.metrics.find((x) => x.id === id);
    return m && isMeasured(m) ? m : null;
  };
  return ids.map((id) => {
    const b = find(before, id);
    const a = find(after, id);
    const unit = a?.unit ?? b?.unit ?? '';
    const change = a && b && a.value !== null && b.value !== null ? a.value - b.value : null;
    const shown = change === null ? null : Number(formatValue(change, unit));
    return {
      id,
      unit,
      before: b,
      after: a,
      change,
      direction:
        shown === null || Number.isNaN(shown)
          ? null
          : shown === 0
            ? 'same'
            : shown > 0
              ? 'higher'
              : 'lower',
    };
  });
}
