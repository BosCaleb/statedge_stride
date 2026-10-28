import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { CalibrationSummary, StanceEvent } from '@stride/shared/analysisResult';
import type { BaseReasonCode, MetricId, Side } from '@stride/shared/enums';
import {
  angleFromDownVertical,
  angleFromHorizontal,
  angleFromUpVertical,
  interiorAngle,
} from './geometry';
import { contactPoint } from './events';
import { landmarkAt, midHip, midShoulder } from './orientation';
import { mean, median, sampleSd } from './stats';
import { LM, SIDE_LANDMARKS, type Track } from './types';

// Stage 5: metric formulas. Every metric is a pure function of the cleaned track (analysis
// coordinates: forward +x, y down, side-on camera), the events, the calibration and the config.

export interface MetricInputs {
  track: Track;
  /** Sorted by initial contact time. */
  events: readonly StanceEvent[];
  legLengthPx: number;
  calibration: CalibrationSummary | null;
  nearSide: Side;
  frameStep: number;
  config: AnalysisConfig;
}

/** One frame and the landmarks a metric needs there, for the landmark-quality fraction Ql. */
export interface FrameCheck {
  k: number;
  landmarks: readonly number[];
}

export interface MetricComputation {
  id: MetricId;
  unit: string;
  value: number | null;
  bySide?: { left: number | null; right: number | null };
  sd?: number;
  /** Cycles or events used in total. */
  n: number;
  /** Cycles per side, for per-side metrics. */
  nBySide?: Record<Side, number>;
  checks: FrameCheck[];
  /** Events whose two detection methods are compared for the event-quality fraction Qe. */
  events: StanceEvent[];
  needsEvents: boolean;
  perSide: boolean;
  sidesUsed: Side[];
  /** A required input is missing, so the metric is unavailable for this reason. */
  missing?: BaseReasonCode;
  secondary?: { value: number | null; unit: string };
}

const BOTH_FEET = [LM.leftHeel, LM.leftFootIndex, LM.rightHeel, LM.rightFootIndex];
const HIPS = [LM.leftHip, LM.rightHip];
const SHOULDERS = [LM.leftShoulder, LM.rightShoulder];

function sampleIndex(frame: number, frameStep: number): number {
  return Math.round(frame / frameStep);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = from; k <= to; k++) out.push(k);
  return out;
}

function nullable(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function spread(samples: readonly number[], config: AnalysisConfig): number | undefined {
  if (samples.length < config.spread.minN) return undefined;
  const sd = sampleSd(samples);
  return Number.isFinite(sd) ? sd : undefined;
}

interface Interval {
  from: StanceEvent;
  to: StanceEvent;
  seconds: number;
}

/** Drops intervals longer than `maxIntervalRatio` times the median: an event was missed. */
function withoutMissedEvents(intervals: Interval[], config: AnalysisConfig): Interval[] {
  const typical = median(intervals.map((i) => i.seconds));
  if (!Number.isFinite(typical)) return intervals;
  return intervals.filter(
    (i) => i.seconds > 0 && i.seconds <= config.events.maxIntervalRatio * typical,
  );
}

/** Steps: consecutive initial contacts of opposite feet. */
export function stepIntervals(events: readonly StanceEvent[], config: AnalysisConfig): Interval[] {
  const out: Interval[] = [];
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    if (a && b && a.side !== b.side)
      out.push({ from: a, to: b, seconds: b.icTimeSec - a.icTimeSec });
  }
  return withoutMissedEvents(out, config);
}

/** Strides: consecutive initial contacts of the same foot with exactly one opposite contact between. */
export function strideIntervals(
  events: readonly StanceEvent[],
  side: Side,
  config: AnalysisConfig,
): Interval[] {
  const out: Interval[] = [];
  for (let i = 2; i < events.length; i++) {
    const a = events[i - 2];
    const mid = events[i - 1];
    const b = events[i];
    if (a && mid && b && a.side === side && b.side === side && mid.side !== side) {
      out.push({ from: a, to: b, seconds: b.icTimeSec - a.icTimeSec });
    }
  }
  return withoutMissedEvents(out, config);
}

function perSideSummary(samples: Record<Side, number[]>) {
  const all = [...samples.left, ...samples.right];
  return {
    value: nullable(mean(all)),
    bySide: { left: nullable(mean(samples.left)), right: nullable(mean(samples.right)) },
    nBySide: { left: samples.left.length, right: samples.right.length },
    n: all.length,
    sidesUsed: (['left', 'right'] as const).filter((s) => samples[s].length > 0),
    all,
  };
}

function base(id: MetricId, unit: string): MetricComputation {
  return {
    id,
    unit,
    value: null,
    n: 0,
    checks: [],
    events: [],
    needsEvents: true,
    perSide: false,
    sidesUsed: [],
  };
}

/** cadence: 60 divided by the mean step time. Needs at least three initial contacts. */
function cadence(ctx: MetricInputs): MetricComputation {
  const m = base('cadence', 'spm');
  const steps = stepIntervals(ctx.events, ctx.config);
  if (steps.length < 2) return { ...m, missing: 'few_cycles', n: steps.length };
  const value = 60 / mean(steps.map((s) => s.seconds));
  return {
    ...m,
    value: nullable(value),
    sd: spread(
      steps.map((s) => 60 / s.seconds),
      ctx.config,
    ),
    n: steps.length,
    checks: steps.flatMap((s) => icChecks(s, ctx, [...BOTH_FEET, ...HIPS])),
    events: uniqueEvents(steps),
    sidesUsed: ['left', 'right'],
  };
}

function icChecks(
  interval: Interval,
  ctx: MetricInputs,
  landmarks: readonly number[],
): FrameCheck[] {
  return [
    { k: sampleIndex(interval.from.icFrame, ctx.frameStep), landmarks },
    { k: sampleIndex(interval.to.icFrame, ctx.frameStep), landmarks },
  ];
}

function uniqueEvents(intervals: readonly Interval[]): StanceEvent[] {
  const set = new Set<StanceEvent>();
  for (const i of intervals) {
    set.add(i.from);
    set.add(i.to);
  }
  return [...set];
}

/** stride_frequency: 1 divided by the mean stride time, per side. */
function strideFrequency(ctx: MetricInputs): MetricComputation {
  const m = { ...base('stride_frequency', 'Hz'), perSide: true };
  const strides = {
    left: strideIntervals(ctx.events, 'left', ctx.config),
    right: strideIntervals(ctx.events, 'right', ctx.config),
  };
  const all = [...strides.left, ...strides.right];
  if (all.length === 0) return { ...m, missing: 'few_cycles' };
  const freq = (list: Interval[]) => (list.length > 0 ? 1 / mean(list.map((s) => s.seconds)) : NaN);
  return {
    ...m,
    value: nullable(freq(all)),
    bySide: { left: nullable(freq(strides.left)), right: nullable(freq(strides.right)) },
    sd: spread(
      all.map((s) => 1 / s.seconds),
      ctx.config,
    ),
    n: all.length,
    nBySide: { left: strides.left.length, right: strides.right.length },
    checks: all.flatMap((s) => icChecks(s, ctx, [...BOTH_FEET, ...HIPS])),
    events: uniqueEvents(all),
    sidesUsed: (['left', 'right'] as const).filter((s) => strides[s].length > 0),
  };
}

function stanceChecks(
  event: StanceEvent,
  ctx: MetricInputs,
  landmarks: readonly number[],
): FrameCheck[] {
  const from = sampleIndex(event.icFrame, ctx.frameStep);
  const to = event.toFrame === null ? from : sampleIndex(event.toFrame, ctx.frameStep);
  return range(from, to).map((k) => ({ k, landmarks }));
}

/** contact_time: mean of toe-off time minus initial contact time, per side. */
function contactTime(ctx: MetricInputs): MetricComputation {
  const m = { ...base('contact_time', 'ms'), perSide: true };
  const used = ctx.events.filter((e) => e.toTimeSec !== null);
  const samples: Record<Side, number[]> = { left: [], right: [] };
  for (const e of used) samples[e.side].push(((e.toTimeSec ?? 0) - e.icTimeSec) * 1000);
  const s = perSideSummary(samples);
  if (s.n === 0) return { ...m, missing: 'few_cycles' };
  return {
    ...m,
    value: s.value,
    bySide: s.bySide,
    sd: spread(s.all, ctx.config),
    n: s.n,
    nBySide: s.nBySide,
    checks: used.flatMap((e) => {
      const sl = SIDE_LANDMARKS[e.side];
      return stanceChecks(e, ctx, [sl.heel, sl.footIndex]);
    }),
    events: used,
    sidesUsed: s.sidesUsed,
  };
}

/** flight_time: mean of the next initial contact (other foot) minus toe-off. */
function flightTime(ctx: MetricInputs): MetricComputation {
  const m = base('flight_time', 'ms');
  const steps = stepIntervals(ctx.events, ctx.config).filter((s) => s.from.toTimeSec !== null);
  if (steps.length === 0) return { ...m, missing: 'few_cycles' };
  const samples = steps.map((s) => (s.to.icTimeSec - (s.from.toTimeSec ?? 0)) * 1000);
  return {
    ...m,
    value: nullable(mean(samples)),
    sd: spread(samples, ctx.config),
    n: samples.length,
    checks: steps.flatMap((s) => {
      const k1 = sampleIndex(s.from.toFrame ?? s.from.icFrame, ctx.frameStep);
      const k2 = sampleIndex(s.to.icFrame, ctx.frameStep);
      return [
        { k: k1, landmarks: BOTH_FEET },
        { k: k2, landmarks: BOTH_FEET },
      ];
    }),
    events: uniqueEvents(steps),
    sidesUsed: ['left', 'right'],
  };
}

function midHipX(ctx: MetricInputs, frame: number): number {
  return midHip(ctx.track, sampleIndex(frame, ctx.frameStep))?.x ?? NaN;
}

/** step_length: horizontal travel of the mid-hip between consecutive initial contacts. */
function stepLength(ctx: MetricInputs): MetricComputation {
  const m = base('step_length', 'm');
  if (!ctx.calibration) return { ...m, missing: 'needs_calibration' };
  const steps = stepIntervals(ctx.events, ctx.config);
  if (steps.length < 2) return { ...m, missing: 'few_cycles', n: steps.length };
  const px = ctx.calibration.pxPerM;
  const samples = steps
    .map((s) => (midHipX(ctx, s.to.icFrame) - midHipX(ctx, s.from.icFrame)) / px)
    .filter(Number.isFinite);
  return {
    ...m,
    value: nullable(mean(samples)),
    sd: spread(samples, ctx.config),
    n: samples.length,
    checks: steps.flatMap((s) => icChecks(s, ctx, HIPS)),
    events: uniqueEvents(steps),
    sidesUsed: ['left', 'right'],
  };
}

/** stride_length: horizontal travel of the mid-hip between consecutive same-foot initial contacts. */
function strideLength(ctx: MetricInputs): MetricComputation {
  const m = { ...base('stride_length', 'm'), perSide: true };
  if (!ctx.calibration) return { ...m, missing: 'needs_calibration' };
  const px = ctx.calibration.pxPerM;
  const strides = {
    left: strideIntervals(ctx.events, 'left', ctx.config),
    right: strideIntervals(ctx.events, 'right', ctx.config),
  };
  const samples: Record<Side, number[]> = { left: [], right: [] };
  for (const side of ['left', 'right'] as const) {
    for (const s of strides[side]) {
      const d = (midHipX(ctx, s.to.icFrame) - midHipX(ctx, s.from.icFrame)) / px;
      if (Number.isFinite(d)) samples[side].push(d);
    }
  }
  const sum = perSideSummary(samples);
  if (sum.n === 0) return { ...m, missing: 'few_cycles' };
  const all = [...strides.left, ...strides.right];
  return {
    ...m,
    value: sum.value,
    bySide: sum.bySide,
    sd: spread(sum.all, ctx.config),
    n: sum.n,
    nBySide: sum.nBySide,
    checks: all.flatMap((s) => icChecks(s, ctx, HIPS)),
    events: uniqueEvents(all),
    sidesUsed: sum.sidesUsed,
  };
}

/** speed: horizontal travel of the mid-hip over the analysed events divided by elapsed time. */
function speed(ctx: MetricInputs): MetricComputation {
  const m = base('speed', 'm/s');
  if (!ctx.calibration) return { ...m, missing: 'needs_calibration' };
  const steps = stepIntervals(ctx.events, ctx.config);
  const first = ctx.events[0];
  const last = ctx.events[ctx.events.length - 1];
  if (!first || !last || first === last || steps.length === 0)
    return { ...m, missing: 'few_cycles' };
  const px = ctx.calibration.pxPerM;
  const elapsed = last.icTimeSec - first.icTimeSec;
  const value = (midHipX(ctx, last.icFrame) - midHipX(ctx, first.icFrame)) / px / elapsed;
  const perStep = steps
    .map((s) => (midHipX(ctx, s.to.icFrame) - midHipX(ctx, s.from.icFrame)) / px / s.seconds)
    .filter(Number.isFinite);
  return {
    ...m,
    value: nullable(value),
    sd: spread(perStep, ctx.config),
    n: steps.length,
    checks: [
      { k: sampleIndex(first.icFrame, ctx.frameStep), landmarks: HIPS },
      { k: sampleIndex(last.icFrame, ctx.frameStep), landmarks: HIPS },
    ],
    events: [first, last],
    sidesUsed: ['left', 'right'],
  };
}

type IcValue = (ctx: MetricInputs, event: StanceEvent, k: number) => number;

/** A per-side quantity evaluated at each initial contact. */
function atInitialContact(
  ctx: MetricInputs,
  id: MetricId,
  unit: string,
  landmarksFor: (side: Side) => readonly number[],
  valueAt: IcValue,
): MetricComputation {
  const m = { ...base(id, unit), perSide: true };
  const samples: Record<Side, number[]> = { left: [], right: [] };
  const used: StanceEvent[] = [];
  const checks: FrameCheck[] = [];
  for (const e of ctx.events) {
    const k = sampleIndex(e.icFrame, ctx.frameStep);
    checks.push({ k, landmarks: landmarksFor(e.side) });
    const v = valueAt(ctx, e, k);
    if (Number.isFinite(v)) {
      samples[e.side].push(v);
      used.push(e);
    }
  }
  const s = perSideSummary(samples);
  if (s.n === 0)
    return { ...m, missing: ctx.events.length === 0 ? 'few_cycles' : 'missing_input', checks };
  return {
    ...m,
    value: s.value,
    bySide: s.bySide,
    sd: spread(s.all, ctx.config),
    n: s.n,
    nBySide: s.nBySide,
    checks,
    events: used,
    sidesUsed: s.sidesUsed,
  };
}

/** overstride: (contact point x minus mid-hip x at IC) / leg length * 100. Positive when ahead. */
function overstride(ctx: MetricInputs): MetricComputation {
  return atInitialContact(
    ctx,
    'overstride',
    '%L',
    (side) => [SIDE_LANDMARKS[side].heel, SIDE_LANDMARKS[side].footIndex, ...HIPS],
    (c, e, k) => {
      const cp = contactPoint(c.track, e.side, k);
      const m = midHip(c.track, k);
      return cp && m ? ((cp.x - m.x) / c.legLengthPx) * 100 : NaN;
    },
  );
}

/** shin_angle_ic: knee-to-ankle vector against vertical at IC. Positive when the ankle is ahead. */
function shinAngle(ctx: MetricInputs): MetricComputation {
  return atInitialContact(
    ctx,
    'shin_angle_ic',
    'deg',
    (side) => [SIDE_LANDMARKS[side].knee, SIDE_LANDMARKS[side].ankle],
    (c, e, k) => {
      const s = SIDE_LANDMARKS[e.side];
      const knee = landmarkAt(c.track, s.knee, k);
      const ankle = landmarkAt(c.track, s.ankle, k);
      return knee && ankle ? angleFromDownVertical(knee, ankle) : NaN;
    },
  );
}

/** knee_flexion_ic: 180 minus the interior angle hip, knee, ankle at IC. */
function kneeFlexion(ctx: MetricInputs): MetricComputation {
  return atInitialContact(
    ctx,
    'knee_flexion_ic',
    'deg',
    (side) => [SIDE_LANDMARKS[side].hip, SIDE_LANDMARKS[side].knee, SIDE_LANDMARKS[side].ankle],
    (c, e, k) => {
      const s = SIDE_LANDMARKS[e.side];
      const hip = landmarkAt(c.track, s.hip, k);
      const knee = landmarkAt(c.track, s.knee, k);
      const ankle = landmarkAt(c.track, s.ankle, k);
      return hip && knee && ankle ? 180 - interiorAngle(hip, knee, ankle) : NaN;
    },
  );
}

/** hip_flexion_ic: 180 minus the interior angle shoulder, hip, knee at IC. */
function hipFlexion(ctx: MetricInputs): MetricComputation {
  return atInitialContact(
    ctx,
    'hip_flexion_ic',
    'deg',
    (side) => [SIDE_LANDMARKS[side].shoulder, SIDE_LANDMARKS[side].hip, SIDE_LANDMARKS[side].knee],
    (c, e, k) => {
      const s = SIDE_LANDMARKS[e.side];
      const shoulder = landmarkAt(c.track, s.shoulder, k);
      const hip = landmarkAt(c.track, s.hip, k);
      const knee = landmarkAt(c.track, s.knee, k);
      return shoulder && hip && knee ? 180 - interiorAngle(shoulder, hip, knee) : NaN;
    },
  );
}

/** foot_angle_ic (experimental): heel to foot-index line against horizontal at IC. */
function footAngle(ctx: MetricInputs): MetricComputation {
  return atInitialContact(
    ctx,
    'foot_angle_ic',
    'deg',
    (side) => [SIDE_LANDMARKS[side].heel, SIDE_LANDMARKS[side].footIndex],
    (c, e, k) => {
      const s = SIDE_LANDMARKS[e.side];
      const heel = landmarkAt(c.track, s.heel, k);
      const toe = landmarkAt(c.track, s.footIndex, k);
      return heel && toe ? angleFromHorizontal(heel, toe) : NaN;
    },
  );
}

/** trunk_lean: mid-hip to mid-shoulder against vertical, averaged over stance. Positive forward. */
function trunkLean(ctx: MetricInputs): MetricComputation {
  const m = base('trunk_lean', 'deg');
  const stances = ctx.events.filter((e) => e.toFrame !== null);
  const samples: number[] = [];
  const used: StanceEvent[] = [];
  const checks: FrameCheck[] = [];
  for (const e of stances) {
    const from = sampleIndex(e.icFrame, ctx.frameStep);
    const to = sampleIndex(e.toFrame ?? e.icFrame, ctx.frameStep);
    const angles: number[] = [];
    for (let k = from; k <= to; k++) {
      checks.push({ k, landmarks: [...HIPS, ...SHOULDERS] });
      const hip = midHip(ctx.track, k);
      const shoulder = midShoulder(ctx.track, k);
      if (hip && shoulder) angles.push(angleFromUpVertical(hip, shoulder));
    }
    if (angles.length > 0) {
      samples.push(mean(angles));
      used.push(e);
    }
  }
  if (samples.length === 0)
    return { ...m, missing: stances.length === 0 ? 'few_cycles' : 'missing_input', checks };
  return {
    ...m,
    value: nullable(mean(samples)),
    sd: spread(samples, ctx.config),
    n: samples.length,
    checks,
    events: used,
    sidesUsed: ['left', 'right'],
  };
}

/**
 * vertical_oscillation: mean peak-to-peak of the detrended mid-hip y over each stride
 * (non-overlapping), as a percentage of leg length, with centimetres as the secondary value.
 * The trend removed is the line through the stride's two end points, which are at the same gait
 * phase; a least-squares line would tilt with the oscillation's phase and inflate the range.
 */
function verticalOscillation(ctx: MetricInputs): MetricComputation {
  const m = base('vertical_oscillation', '%L');
  const windows: { from: StanceEvent; to: StanceEvent }[] = [];
  for (let i = 0; i + 2 < ctx.events.length; i += 2) {
    const a = ctx.events[i];
    const mid = ctx.events[i + 1];
    const b = ctx.events[i + 2];
    if (a && mid && b && a.side === b.side && mid.side !== a.side) windows.push({ from: a, to: b });
  }
  const strides = withoutMissedEvents(
    windows.map((w) => ({ ...w, seconds: w.to.icTimeSec - w.from.icTimeSec })),
    ctx.config,
  );
  const amplitudesPx: number[] = [];
  const checks: FrameCheck[] = [];
  const used: StanceEvent[] = [];
  const endY = (k: number) => {
    const values: number[] = [];
    for (let j = k - 2; j <= k + 2; j++) {
      const hip = midHip(ctx.track, j);
      if (hip) values.push(hip.y);
    }
    return mean(values);
  };
  for (const s of strides) {
    const from = sampleIndex(s.from.icFrame, ctx.frameStep);
    const to = sampleIndex(s.to.icFrame, ctx.frameStep);
    const y0 = endY(from);
    const y1 = endY(to);
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || to <= from) continue;
    let lo = Infinity;
    let hi = -Infinity;
    let count = 0;
    for (let k = from; k <= to; k++) {
      checks.push({ k, landmarks: HIPS });
      const hip = midHip(ctx.track, k);
      if (!hip) continue;
      const r = hip.y - (y0 + ((y1 - y0) * (k - from)) / (to - from));
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      count++;
    }
    if (count < 4) continue;
    amplitudesPx.push(hi - lo);
    used.push(s.from, s.to);
  }
  if (amplitudesPx.length === 0) return { ...m, missing: 'few_cycles', checks };
  const percent = amplitudesPx.map((a) => (a / ctx.legLengthPx) * 100);
  const cm = ctx.calibration ? (mean(amplitudesPx) / ctx.calibration.pxPerM) * 100 : NaN;
  return {
    ...m,
    value: nullable(mean(percent)),
    sd: spread(percent, ctx.config),
    n: amplitudesPx.length,
    checks,
    events: [...new Set(used)],
    sidesUsed: ['left', 'right'],
    secondary: { value: ctx.calibration ? nullable(cm) : null, unit: 'cm' },
  };
}

/** Symmetry index: 100 * |left - right| / mean(left, right). */
function symmetryIndex(left: number, right: number): number {
  const avg = (left + right) / 2;
  return avg > 0 ? (100 * Math.abs(left - right)) / avg : NaN;
}

/** contact_asymmetry: symmetry index of the left and right mean contact times. */
function contactAsymmetry(contact: MetricComputation): MetricComputation {
  const m = base('contact_asymmetry', '%');
  const left = contact.bySide?.left ?? null;
  const right = contact.bySide?.right ?? null;
  const nl = contact.nBySide?.left ?? 0;
  const nr = contact.nBySide?.right ?? 0;
  if (left === null || right === null || nl < 2 || nr < 2) {
    return {
      ...m,
      missing: 'needs_both_sides',
      n: nl + nr,
      checks: contact.checks,
      events: contact.events,
    };
  }
  return {
    ...m,
    value: nullable(symmetryIndex(left, right)),
    n: Math.min(nl, nr),
    checks: contact.checks,
    events: contact.events,
    sidesUsed: ['left', 'right'],
  };
}

/** step_time_asymmetry: symmetry index of the step times ending on each foot. */
function stepTimeAsymmetry(ctx: MetricInputs): MetricComputation {
  const m = base('step_time_asymmetry', '%');
  const steps = stepIntervals(ctx.events, ctx.config);
  const left = steps.filter((s) => s.to.side === 'left').map((s) => s.seconds);
  const right = steps.filter((s) => s.to.side === 'right').map((s) => s.seconds);
  const checks = steps.flatMap((s) => icChecks(s, ctx, [...BOTH_FEET, ...HIPS]));
  if (left.length === 0 || right.length === 0) {
    return {
      ...m,
      missing: 'needs_both_sides',
      n: steps.length,
      checks,
      events: uniqueEvents(steps),
    };
  }
  return {
    ...m,
    value: nullable(symmetryIndex(mean(left), mean(right))),
    n: Math.min(left.length, right.length),
    checks,
    events: uniqueEvents(steps),
    sidesUsed: ['left', 'right'],
  };
}

/** arm_swing_range: range of the upper-arm angle against vertical over each stride, per side. */
function armSwingRange(ctx: MetricInputs): MetricComputation {
  const m = { ...base('arm_swing_range', 'deg'), perSide: true };
  const samples: Record<Side, number[]> = { left: [], right: [] };
  const checks: FrameCheck[] = [];
  const used: StanceEvent[] = [];
  for (const side of ['left', 'right'] as const) {
    const s = SIDE_LANDMARKS[side];
    for (const stride of strideIntervals(ctx.events, side, ctx.config)) {
      const from = sampleIndex(stride.from.icFrame, ctx.frameStep);
      const to = sampleIndex(stride.to.icFrame, ctx.frameStep);
      let lo = Infinity;
      let hi = -Infinity;
      let count = 0;
      for (let k = from; k <= to; k++) {
        checks.push({ k, landmarks: [s.shoulder, s.elbow] });
        const shoulder = landmarkAt(ctx.track, s.shoulder, k);
        const elbow = landmarkAt(ctx.track, s.elbow, k);
        if (!shoulder || !elbow) continue;
        const a = angleFromDownVertical(shoulder, elbow);
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
        count++;
      }
      if (count >= 4) {
        samples[side].push(hi - lo);
        used.push(stride.from, stride.to);
      }
    }
  }
  const sum = perSideSummary(samples);
  if (sum.n === 0) return { ...m, missing: 'few_cycles', checks };
  return {
    ...m,
    value: sum.value,
    bySide: sum.bySide,
    sd: spread(sum.all, ctx.config),
    n: sum.n,
    nBySide: sum.nBySide,
    checks,
    events: [...new Set(used)],
    sidesUsed: sum.sidesUsed,
  };
}

/** Computes every metric (foot_angle_ic only when its feature flag is on). */
export function computeMetrics(ctx: MetricInputs): MetricComputation[] {
  const contact = contactTime(ctx);
  const out = [
    cadence(ctx),
    strideFrequency(ctx),
    contact,
    flightTime(ctx),
    stepLength(ctx),
    strideLength(ctx),
    speed(ctx),
    overstride(ctx),
    shinAngle(ctx),
    kneeFlexion(ctx),
    hipFlexion(ctx),
    trunkLean(ctx),
    verticalOscillation(ctx),
    contactAsymmetry(contact),
    stepTimeAsymmetry(ctx),
    armSwingRange(ctx),
  ];
  if (ctx.config.metrics.featureFlags.footAngleIc) out.push(footAngle(ctx));
  return out;
}
