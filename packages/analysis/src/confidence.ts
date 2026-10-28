import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { MetricResult, StanceEvent } from '@stride/shared/analysisResult';
import type { Confidence, MetricId, ReasonCode, Side } from '@stride/shared/enums';
import type { FrameCheck, MetricComputation } from './metrics';
import type { Track } from './types';

// Confidence labels. A label comes from four measured qualities of the data actually used, and
// is then capped by a ceiling for the metric. Every lowered label carries at least one reason.

const RANK: Record<Confidence, number> = { unavailable: 0, low: 1, medium: 2, high: 3 };

export function lowerOf(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Ql: the fraction of checked frames where every landmark the metric needs is present after gap filling. */
export function landmarkQuality(track: Track, checks: readonly FrameCheck[]): number {
  if (checks.length === 0) return 0;
  let good = 0;
  for (const check of checks) {
    let ok = check.k >= 0 && check.k < track.frameCount;
    for (const l of check.landmarks) {
      if (!ok) break;
      ok =
        Number.isFinite(track.x[l]?.[check.k] ?? NaN) &&
        Number.isFinite(track.y[l]?.[check.k] ?? NaN);
    }
    if (ok) good++;
  }
  return good / checks.length;
}

/** Qe: the fraction of the used events whose two detection methods agree. */
export function eventQuality(events: readonly StanceEvent[]): number {
  if (events.length === 0) return 0;
  return events.filter((e) => e.agreement === 'both').length / events.length;
}

/** Sensitive to a one or two frame error in the event times. */
const TIMING_METRICS: readonly MetricId[] = ['contact_time', 'flight_time'];
/** Planar scale only: assumes the athlete runs in the calibrated plane. */
const PLANAR_METRICS: readonly MetricId[] = [
  'step_length',
  'stride_length',
  'speed',
  'vertical_oscillation',
];
/** Elbow, heel and toe landmarks are the least reliable. */
const LEAST_RELIABLE_METRICS: readonly MetricId[] = ['arm_swing_range', 'foot_angle_ic'];

export interface ConfidenceContext {
  track: Track;
  config: AnalysisConfig;
  /** Capture rate divided by the frame step. */
  effectiveFps: number;
  nearSide: Side;
  sideLabelsUncertain: boolean;
}

export interface Qualities {
  ql: number;
  qe: number;
  n: number;
}

/** Applies the confidence rules and ceilings to one computed metric. */
export function labelMetric(
  c: MetricComputation,
  ctx: ConfidenceContext,
): { metric: MetricResult; qualities: Qualities } {
  const out: MetricResult = {
    id: c.id,
    value: c.value,
    unit: c.unit,
    n: c.n,
    confidence: 'unavailable',
    reasons: [],
  };
  if (c.secondary) out.secondary = { ...c.secondary };
  const ql = landmarkQuality(ctx.track, c.checks);
  const qe = eventQuality(c.events);
  const qualities = { ql, qe, n: c.n };

  if (c.missing || c.value === null) {
    out.value = null;
    if (out.secondary) out.secondary.value = null;
    out.reasons = [c.missing ?? 'missing_input'];
    return { metric: out, qualities };
  }

  const conf = ctx.config.confidence;
  const sides = c.sidesUsed.length > 0 ? c.sidesUsed : (['left', 'right'] as const);
  const nMin = c.perSide && c.nBySide ? Math.min(...sides.map((s) => c.nBySide?.[s] ?? 0)) : c.n;
  const fpsOk = ctx.effectiveFps >= ctx.config.metrics.minFps;
  const farSide = c.perSide && c.sidesUsed.some((s) => s !== ctx.nearSide);
  const qeOk = (min: number) => !c.needsEvents || qe >= min;

  const high = {
    ql: ql >= conf.high.minQl,
    qe: qeOk(conf.high.minQe),
    n: c.perSide ? nMin >= conf.high.minPerSide : c.n >= conf.high.minSteps,
    fps: fpsOk,
  };
  let label: Confidence;
  if (high.ql && high.qe && high.n && high.fps) label = 'high';
  else if (ql >= conf.medium.minQl && qeOk(conf.medium.minQe) && nMin >= conf.medium.minN)
    label = 'medium';
  else if (ql >= conf.low.minQl && nMin >= conf.low.minN) label = 'low';
  else label = 'unavailable';

  const reasons: ReasonCode[] = [];
  if (!high.ql) reasons.push('landmarks_unclear');
  if (!high.qe) reasons.push('events_disagree');
  if (!high.n) reasons.push('few_cycles');
  if (!high.fps) reasons.push('low_frame_rate');

  const cap = (ceiling: Confidence, reason: ReasonCode) => {
    if (RANK[label] > RANK[ceiling]) label = ceiling;
    reasons.push(reason);
  };
  if (TIMING_METRICS.includes(c.id)) {
    const timingHigh =
      ctx.effectiveFps >= ctx.config.metrics.timingHighFps && qe >= ctx.config.metrics.timingHighQe;
    if (!timingHigh) cap('medium', 'timing_sensitive');
  }
  if (PLANAR_METRICS.includes(c.id)) cap('medium', 'planar_scale');
  if (LEAST_RELIABLE_METRICS.includes(c.id)) cap('low', 'least_reliable_landmarks');
  if (c.id === 'foot_angle_ic') cap('low', 'experimental');
  if (farSide) cap('medium', 'far_side');
  if (c.perSide && ctx.sideLabelsUncertain) cap('low', 'side_labels_uncertain');

  out.confidence = label;
  if (label === 'high') {
    out.reasons = [];
  } else {
    out.reasons = [...new Set(reasons)];
    if (out.reasons.length === 0) out.reasons = ['few_cycles'];
  }
  if (label === 'unavailable') {
    out.value = null;
    if (out.secondary) out.secondary.value = null;
    return { metric: out, qualities };
  }
  if (c.bySide) out.bySide = { ...c.bySide };
  if (c.sd !== undefined) out.sd = c.sd;
  return { metric: out, qualities };
}
