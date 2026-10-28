import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type {
  AnalysisResult,
  CalibrationSummary,
  ClipSummary,
  GateCheck,
  KeyFrames,
  MetricResult,
  StanceEvent,
} from '@stride/shared/analysisResult';
import { RESULT_SCHEMA_VERSION } from '@stride/shared/analysisResult';
import type { Mode, Side } from '@stride/shared/enums';
import { ALGORITHM_VERSION } from './config';
import { cleanTrack, rawTrackFromFrames } from './clean';
import { labelMetric, type Qualities } from './confidence';
import { detectEvents, type EventDetection } from './events';
import { applyGate, resultChecks, type ResultCheckInput } from './gate';
import { computeMetrics } from './metrics';
import {
  assessSides,
  legLengthPx,
  mirrorTrack,
  steadyForwardShare,
  travelDirection,
  type SideAssessment,
} from './orientation';
import { median } from './stats';
import { LANDMARK_COUNT, LM, SIDE_LANDMARKS, type PoseFrame, type Track } from './types';

// The pure part of an analysis job, from raw landmarks to the final AnalysisResult: clean,
// orientation, events, metrics, confidence and the result-level gate. Everything after pose
// estimation is here, so it runs the same way on recorded keypoint fixtures in tests.

export interface AnalysisInput {
  /** Raw landmarks in full-frame pixels and the original orientation, one per decoded frame. */
  frames: readonly PoseFrame[];
  clip: ClipSummary;
  /** Analysis time of every decoded frame (see chooseTimebase). */
  timesSec: ArrayLike<number>;
  timebase: 'container' | 'declared';
  captureFps: number;
  frameStep: number;
  mode: Mode;
  calibration: CalibrationSummary | null;
  /** Clip-level checks computed before pose estimation. */
  clipChecks: readonly GateCheck[];
  poseModel: { id: string; version: string };
  config: AnalysisConfig;
  /** ISO 8601 UTC. Passed in so that the function stays pure. */
  createdAt: string;
}

export interface AnalysisDiagnostics {
  raw: Track;
  track: Track | null;
  legLengthPx: number;
  sides: SideAssessment | null;
  detection: EventDetection | null;
  qualities: Partial<Record<MetricResult['id'], Qualities>>;
  resultCheckInput: ResultCheckInput | null;
}

export interface AnalysisOutput {
  result: AnalysisResult;
  diagnostics: AnalysisDiagnostics;
}

/** Share of analysed frames with a pose. */
function trackedShare(raw: Track): number {
  if (raw.frameCount === 0) return 0;
  let tracked = 0;
  for (let k = 0; k < raw.frameCount; k++)
    if (Number.isFinite(raw.x[LM.nose]?.[k] ?? NaN)) tracked++;
  return tracked / raw.frameCount;
}

function visibleShare(raw: Track, landmarks: readonly number[], minVisibility: number): number {
  if (raw.frameCount === 0) return 0;
  let visible = 0;
  for (let k = 0; k < raw.frameCount; k++) {
    if (landmarks.every((l) => (raw.v[l]?.[k] ?? 0) >= minVisibility)) visible++;
  }
  return visible / raw.frameCount;
}

/** Median height in pixels of the box around the landmarks that are clearly visible. */
function athleteHeightPx(raw: Track, minVisibility: number): number {
  const heights: number[] = [];
  for (let k = 0; k < raw.frameCount; k++) {
    let top = Infinity;
    let bottom = -Infinity;
    for (let l = 0; l < LANDMARK_COUNT; l++) {
      const y = raw.y[l]?.[k] ?? NaN;
      if ((raw.v[l]?.[k] ?? 0) < minVisibility || !Number.isFinite(y)) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (bottom > top) heights.push(bottom - top);
  }
  return median(heights);
}

/** Median visibility of the near-side heel and foot index over frames with a pose. */
function feetVisibility(raw: Track, side: Side): number {
  const s = SIDE_LANDMARKS[side];
  const values: number[] = [];
  for (let k = 0; k < raw.frameCount; k++) {
    if (!Number.isFinite(raw.x[LM.nose]?.[k] ?? NaN)) continue;
    values.push(((raw.v[s.heel]?.[k] ?? 0) + (raw.v[s.footIndex]?.[k] ?? 0)) / 2);
  }
  return median(values);
}

/** One well-detected stance for the key frames: near side, both methods agree, nearest mid-clip. */
export function chooseKeyFrames(
  events: readonly StanceEvent[],
  nearSide: Side,
  frameCount: number,
): KeyFrames | null {
  const complete = events.filter((e) => e.toFrame !== null);
  if (complete.length === 0) return null;
  const score = (e: StanceEvent) =>
    (e.side === nearSide ? 0 : 2) +
    (e.agreement === 'both' ? 0 : 1) +
    Math.abs(e.icFrame - frameCount / 2) / Math.max(1, frameCount);
  const best = [...complete].sort((a, b) => score(a) - score(b))[0];
  if (!best || best.toFrame === null) return null;
  return {
    side: best.side,
    icFrame: best.icFrame,
    midFrame: Math.round((best.icFrame + best.toFrame) / 2),
    toFrame: best.toFrame,
  };
}

function baseResult(
  input: AnalysisInput,
): Omit<AnalysisResult, 'events' | 'metrics' | 'gate' | 'direction' | 'keyFrames'> {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    poseModel: { ...input.poseModel },
    mode: input.mode,
    clip: { ...input.clip },
    captureFps: input.captureFps,
    timebase: input.timebase,
    frameStep: input.frameStep,
    calibration: input.calibration ? { ...input.calibration } : null,
    configSnapshot: input.config,
    createdAt: input.createdAt,
  };
}

export function analyse(input: AnalysisInput): AnalysisOutput {
  const { config } = input;
  const raw = rawTrackFromFrames(
    input.frames,
    input.clip.frameCount,
    input.frameStep,
    input.timesSec,
    input.clip.widthPx,
    input.clip.heightPx,
  );
  const diagnostics: AnalysisDiagnostics = {
    raw,
    track: null,
    legLengthPx: NaN,
    sides: null,
    detection: null,
    qualities: {},
    resultCheckInput: null,
  };
  const effectiveFps = input.captureFps / input.frameStep;

  if (input.clipChecks.some((c) => c.level === 'fail')) {
    const { gate } = applyGate(input.clipChecks, []);
    return {
      result: {
        ...baseResult(input),
        direction: 1,
        events: [],
        keyFrames: null,
        metrics: [],
        gate,
      },
      diagnostics,
    };
  }

  const cleaned = cleanTrack(raw, config, input.mode, effectiveFps);
  const roughLeg =
    Math.max(legLengthPx(cleaned, 'left') || 0, legLengthPx(cleaned, 'right') || 0) || NaN;
  const travel = travelDirection(cleaned, roughLeg, config);
  const track = travel.direction === 1 ? cleaned : mirrorTrack(cleaned);
  const sides = assessSides(raw, travel.direction, roughLeg, config);
  const nearLeg = legLengthPx(track, sides.nearSide);
  const leg = Number.isFinite(nearLeg) ? nearLeg : roughLeg;
  diagnostics.track = track;
  diagnostics.sides = sides;
  diagnostics.legLengthPx = leg;

  let events: StanceEvent[] = [];
  let labelled: MetricResult[] = [];
  let measuredCadence: number | null = null;
  if (Number.isFinite(leg) && leg > 0) {
    const detection = detectEvents(track, leg, config, input.frameStep);
    diagnostics.detection = detection;
    events = detection.events;
    const computations = computeMetrics({
      track,
      events,
      legLengthPx: leg,
      calibration: input.calibration,
      nearSide: sides.nearSide,
      frameStep: input.frameStep,
      config,
    });
    measuredCadence = computations.find((c) => c.id === 'cadence')?.value ?? null;
    labelled = computations.map((c) => {
      const { metric, qualities } = labelMetric(c, {
        track,
        config,
        effectiveFps,
        nearSide: sides.nearSide,
        sideLabelsUncertain: sides.uncertain,
      });
      diagnostics.qualities[c.id] = qualities;
      return metric;
    });
  }

  const minVis = config.landmarks.minVisibility;
  const near = SIDE_LANDMARKS[sides.nearSide];
  const agreeing = events.filter((e) => e.agreement === 'both').length;
  const checkInput: ResultCheckInput = {
    trackedShare: trackedShare(raw),
    bodyVisibleShare: visibleShare(raw, [near.hip, near.knee, near.ankle], minVis),
    athleteHeightPx: athleteHeightPx(raw, minVis),
    feetVisibility: feetVisibility(raw, sides.nearSide),
    steadyForwardShare: travel.determined ? steadyForwardShare(track, config) : 0,
    initialContacts: events.length,
    alternationBreakShare:
      events.length > 1 ? (diagnostics.detection?.alternationBreaks ?? 0) / (events.length - 1) : 0,
    agreementShare: events.length > 0 ? agreeing / events.length : 0,
    // The plausibility check uses the measured cadence whatever its confidence label.
    cadenceSpm: measuredCadence,
    sideLabelsMatch: !sides.mismatch,
  };
  diagnostics.resultCheckInput = checkInput;
  const checks = [...input.clipChecks, ...resultChecks(checkInput, config.gate)];
  const gated = applyGate(checks, labelled);
  return {
    result: {
      ...baseResult(input),
      direction: travel.direction,
      events,
      keyFrames: chooseKeyFrames(events, sides.nearSide, input.clip.frameCount),
      metrics: gated.metrics,
      gate: gated.gate,
    },
    diagnostics,
  };
}
