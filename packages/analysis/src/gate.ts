import type { GateConfig } from '@stride/shared/analysisConfig';
import type { GateCheck, GateResult, MetricResult } from '@stride/shared/analysisResult';
import type { CheckLevel, Confidence, GateCheckId, MetricId, Mode } from '@stride/shared/enums';
import { lowerOf } from './confidence';

// Stage 6: the quality gate. Clip-level checks run before pose estimation so that a hopeless
// clip fails fast; result-level checks run afterwards. A fail hides every metric; a warning
// hides or caps the metrics listed for it in GATE_EFFECTS.

function check(id: GateCheckId, level: CheckLevel, detail: string): GateCheck {
  return { id, ok: level === 'pass', level, detail };
}

/** pass unless value < warn (warn) or < fail (fail). */
function below(value: number, warnBelow: number, failBelow: number): CheckLevel {
  if (!Number.isFinite(value) || value < failBelow) return 'fail';
  if (value < warnBelow) return 'warn';
  return 'pass';
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

export interface ClipCheckInput {
  decodable: boolean;
  /** Effective capture rate (capture rate divided by the frame step). */
  effectiveFps: number | null;
  mode: Mode;
  /** Share of frame intervals more than the tolerance away from the median. */
  irregularShare: number | null;
  widthPx: number;
  heightPx: number;
  durationSec: number;
  calibrationPresent: boolean;
  athleteSelected: boolean;
  /** Largest camera shift against the calibration and within the clip, full-resolution pixels. */
  cameraShiftPx: number | null;
}

export function clipChecks(input: ClipCheckInput, g: GateConfig): GateCheck[] {
  const checks: GateCheck[] = [];
  checks.push(
    check(
      'codec_decodable',
      input.decodable ? 'pass' : 'fail',
      input.decodable ? 'decoded' : 'cannot decode',
    ),
  );

  const fps = input.effectiveFps ?? NaN;
  let fpsLevel: CheckLevel = 'pass';
  if (!Number.isFinite(fps) || fps < g.fps.failBelow) fpsLevel = 'fail';
  else if (input.mode === 'sprint' && fps < g.fps.warnSprintBelow) fpsLevel = 'warn';
  checks.push(
    check('fps_ok', fpsLevel, Number.isFinite(fps) ? `${fps.toFixed(0)} fps` : 'unknown'),
  );

  const irregular = input.irregularShare ?? NaN;
  let timingLevel: CheckLevel = 'pass';
  if (!Number.isFinite(irregular) || irregular > g.timing.failShare) timingLevel = 'fail';
  else if (irregular > g.timing.warnShare) timingLevel = 'warn';
  checks.push(
    check(
      'timing_regular',
      timingLevel,
      Number.isFinite(irregular) ? `${pct(irregular)} irregular` : 'unknown',
    ),
  );

  // The shorter side, so that a portrait recording of the same resolution is judged the same way.
  const height = Math.min(input.widthPx, input.heightPx);
  checks.push(
    check(
      'resolution_ok',
      below(height, g.resolution.warnHeightBelow, g.resolution.failHeightBelow),
      `${height} px`,
    ),
  );

  const d = input.durationSec;
  let durationLevel: CheckLevel = 'pass';
  if (!(d >= g.durationSec.min) || d > g.durationSec.failOver) durationLevel = 'fail';
  else if (d > g.durationSec.warnOver) durationLevel = 'warn';
  checks.push(check('duration_ok', durationLevel, `${d.toFixed(1)} s`));

  checks.push(
    check(
      'calibration_present',
      input.calibrationPresent ? 'pass' : 'warn',
      input.calibrationPresent ? 'present' : 'missing',
    ),
  );
  checks.push(
    check(
      'athlete_selected',
      input.athleteSelected ? 'pass' : 'fail',
      input.athleteSelected ? 'box drawn' : 'missing',
    ),
  );

  const shift = input.cameraShiftPx;
  let shiftLevel: CheckLevel = 'pass';
  if (shift !== null && shift > g.cameraShiftPx.fail) shiftLevel = 'fail';
  else if (shift !== null && shift > g.cameraShiftPx.warn) shiftLevel = 'warn';
  const shiftDetail =
    shift === null
      ? 'not measured'
      : Number.isFinite(shift)
        ? `${shift.toFixed(1)} px`
        : 'not comparable';
  checks.push(check('camera_stable', shiftLevel, shiftDetail));
  return checks;
}

export interface ResultCheckInput {
  trackedShare: number;
  bodyVisibleShare: number;
  athleteHeightPx: number;
  feetVisibility: number;
  steadyForwardShare: number;
  initialContacts: number;
  alternationBreakShare: number;
  agreementShare: number;
  cadenceSpm: number | null;
  sideLabelsMatch: boolean;
}

export function resultChecks(input: ResultCheckInput, g: GateConfig): GateCheck[] {
  const checks: GateCheck[] = [];
  checks.push(
    check(
      'person_tracked',
      below(input.trackedShare, g.tracked.warnBelow, g.tracked.failBelow),
      `${pct(input.trackedShare)} of frames`,
    ),
  );
  checks.push(
    check(
      'body_visible',
      below(input.bodyVisibleShare, g.bodyVisible.warnBelow, g.bodyVisible.failBelow),
      `${pct(input.bodyVisibleShare)} of frames`,
    ),
  );
  const h = input.athleteHeightPx;
  checks.push(
    check(
      'athlete_size',
      below(h, g.athleteHeightPx.warnBelow, g.athleteHeightPx.failBelow),
      Number.isFinite(h) ? `${h.toFixed(0)} px` : 'unknown',
    ),
  );
  checks.push(
    check(
      'feet_visible',
      below(input.feetVisibility, g.feetVisibility.warnBelow, g.feetVisibility.failBelow),
      Number.isFinite(input.feetVisibility) ? input.feetVisibility.toFixed(2) : 'unknown',
    ),
  );
  checks.push(
    check(
      'steady_direction',
      below(input.steadyForwardShare, g.steadyDirection.warnBelow, g.steadyDirection.failBelow),
      `${pct(input.steadyForwardShare)} forward`,
    ),
  );
  checks.push(
    check(
      'events_found',
      below(input.initialContacts, g.events.warnBelow, g.events.failBelow),
      `${input.initialContacts} contacts`,
    ),
  );

  let alternateLevel: CheckLevel = 'pass';
  if (input.alternationBreakShare > g.events.alternateFail) alternateLevel = 'fail';
  else if (input.alternationBreakShare > g.events.alternateWarn) alternateLevel = 'warn';
  checks.push(
    check('events_alternate', alternateLevel, `${pct(input.alternationBreakShare)} out of order`),
  );

  checks.push(
    check(
      'method_agreement',
      input.agreementShare < g.agreementWarnBelow ? 'warn' : 'pass',
      `${pct(input.agreementShare)} agree`,
    ),
  );

  const cadence = input.cadenceSpm;
  const plausible =
    cadence === null || (cadence >= g.cadenceSpm.min && cadence <= g.cadenceSpm.max);
  checks.push(
    check(
      'timebase_plausible',
      plausible ? 'pass' : 'fail',
      cadence === null ? 'not measured' : `${cadence.toFixed(0)} spm`,
    ),
  );

  checks.push(
    check(
      'side_labels',
      input.sideLabelsMatch ? 'pass' : 'warn',
      input.sideLabelsMatch ? 'match' : 'mismatch',
    ),
  );
  return checks;
}

type MetricSelection = readonly MetricId[] | 'all' | 'per-side';

interface GateEffect {
  /** Hidden completely: no value is shown, saved in the metric rows or reported. */
  hide?: readonly MetricId[];
  /** Only the secondary value is hidden (vertical_oscillation in centimetres). */
  hideSecondary?: readonly MetricId[];
  /** The confidence label is lowered to at most this level. */
  cap?: { level: Confidence; metrics: MetricSelection };
}

/**
 * Which warnings hide or cap which metrics. The first two rows are from the specification; the
 * others are proposed defaults (docs/decisions.md) to be reviewed with the spike results.
 * side_labels is not here: its cap (per-side metrics at low) is a confidence ceiling.
 */
export const GATE_EFFECTS: Partial<Record<GateCheckId, GateEffect>> = {
  calibration_present: {
    hide: ['step_length', 'stride_length', 'speed'],
    hideSecondary: ['vertical_oscillation'],
  },
  fps_ok: { cap: { level: 'medium', metrics: ['contact_time', 'flight_time'] } },
  timing_regular: {
    cap: {
      level: 'medium',
      metrics: ['contact_time', 'flight_time', 'cadence', 'stride_frequency'],
    },
  },
  resolution_ok: {
    cap: {
      level: 'medium',
      metrics: ['overstride', 'shin_angle_ic', 'arm_swing_range', 'foot_angle_ic'],
    },
  },
  camera_stable: {
    cap: {
      level: 'low',
      metrics: ['step_length', 'stride_length', 'speed', 'vertical_oscillation'],
    },
  },
  person_tracked: { cap: { level: 'medium', metrics: 'all' } },
  body_visible: { cap: { level: 'medium', metrics: 'all' } },
  athlete_size: { cap: { level: 'medium', metrics: 'all' } },
  feet_visible: {
    cap: {
      level: 'medium',
      metrics: [
        'contact_time',
        'flight_time',
        'overstride',
        'shin_angle_ic',
        'foot_angle_ic',
        'cadence',
        'stride_frequency',
      ],
    },
  },
  steady_direction: {
    cap: { level: 'medium', metrics: ['speed', 'step_length', 'stride_length'] },
  },
  events_alternate: {
    cap: {
      level: 'medium',
      metrics: ['cadence', 'step_length', 'step_time_asymmetry', 'flight_time'],
    },
  },
};

const PER_SIDE_METRICS: readonly MetricId[] = [
  'stride_frequency',
  'contact_time',
  'stride_length',
  'overstride',
  'shin_angle_ic',
  'knee_flexion_ic',
  'hip_flexion_ic',
  'arm_swing_range',
  'foot_angle_ic',
];

function selects(selection: MetricSelection, id: MetricId): boolean {
  if (selection === 'all') return true;
  if (selection === 'per-side') return PER_SIDE_METRICS.includes(id);
  return selection.includes(id);
}

function hideMetric(m: MetricResult, reason: GateCheckId): MetricResult {
  const hidden: MetricResult = {
    id: m.id,
    value: null,
    unit: m.unit,
    n: m.n,
    confidence: 'unavailable',
    reasons: [`gate:${reason}`],
  };
  if (m.secondary) hidden.secondary = { value: null, unit: m.secondary.unit };
  return hidden;
}

/** Combines the checks into a status and applies their effects to the metrics. */
export function applyGate(
  checks: readonly GateCheck[],
  metrics: readonly MetricResult[],
): { gate: GateResult; metrics: MetricResult[] } {
  const failed = checks.some((c) => c.level === 'fail');
  const warned = checks.some((c) => c.level === 'warn');
  const status = failed ? 'fail' : warned ? 'conditional' : 'pass';
  if (failed) {
    return {
      gate: { status, checks: [...checks], hiddenMetrics: metrics.map((m) => m.id) },
      metrics: metrics.map((m) =>
        hideMetric(m, checks.find((c) => c.level === 'fail')?.id ?? 'codec_decodable'),
      ),
    };
  }
  const hidden = new Set<MetricId>();
  const out = metrics.map((m) => {
    let metric: MetricResult = { ...m, reasons: [...m.reasons] };
    for (const c of checks) {
      if (c.level !== 'warn') continue;
      const effect = GATE_EFFECTS[c.id];
      if (!effect) continue;
      if (effect.hide?.includes(metric.id)) {
        hidden.add(metric.id);
        metric = hideMetric(metric, c.id);
        continue;
      }
      if (effect.hideSecondary?.includes(metric.id) && metric.secondary) {
        metric.secondary = { value: null, unit: metric.secondary.unit };
        metric.reasons.push(`gate:${c.id}`);
      }
      if (
        effect.cap &&
        selects(effect.cap.metrics, metric.id) &&
        metric.confidence !== 'unavailable'
      ) {
        const capped = lowerOf(metric.confidence, effect.cap.level);
        if (capped !== metric.confidence) {
          metric.confidence = capped;
          metric.reasons.push(`gate:${c.id}`);
        }
      }
    }
    metric.reasons = [...new Set(metric.reasons)];
    return metric;
  });
  return { gate: { status, checks: [...checks], hiddenMetrics: [...hidden] }, metrics: out };
}
