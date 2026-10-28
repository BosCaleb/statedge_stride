import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { StanceEvent } from '@stride/shared/analysisResult';
import type { Side } from '@stride/shared/enums';
import { landmarkAt, midHip } from './orientation';
import { linearFit, quantile, seededRandom, type LineFit } from './stats';
import { SIDE_LANDMARKS, type Point, type Track } from './types';

// Stage 4: stance detection with two independent methods per side, and their cross-check.

const SIDES: readonly Side[] = ['left', 'right'];

export interface ContactPoint extends Point {
  /** Landmark index of the lower of heel and foot index. */
  landmark: number;
}

/** The lower (larger y) of the heel and foot-index points, or the one that is present. */
export function contactPoint(track: Track, side: Side, k: number): ContactPoint | null {
  const s = SIDE_LANDMARKS[side];
  const heel = landmarkAt(track, s.heel, k);
  const toe = landmarkAt(track, s.footIndex, k);
  if (heel && toe)
    return heel.y >= toe.y ? { ...heel, landmark: s.heel } : { ...toe, landmark: s.footIndex };
  if (heel) return { ...heel, landmark: s.heel };
  if (toe) return { ...toe, landmark: s.footIndex };
  return null;
}

/** Speed of one landmark at sample k in pixels per second (central difference where possible). */
function landmarkSpeed(track: Track, landmark: number, k: number): number {
  const here = landmarkAt(track, landmark, k);
  if (!here) return NaN;
  const prev = k > 0 ? landmarkAt(track, landmark, k - 1) : null;
  const next = k < track.frameCount - 1 ? landmarkAt(track, landmark, k + 1) : null;
  const a = prev ?? here;
  const b = next ?? here;
  const ka = prev ? k - 1 : k;
  const kb = next ? k + 1 : k;
  const dt = (track.times[kb] ?? NaN) - (track.times[ka] ?? NaN);
  if (!(dt > 0)) return NaN;
  return Math.hypot(b.x - a.x, b.y - a.y) / dt;
}

/**
 * Robust ground line y = a + b x through the lowest foot points: per leg-length bin of x, keep
 * the lowest share of contact points, then RANSAC (seeded, so repeatable) and a least-squares
 * refit on the inliers. Falls back to a level line at the 95th percentile of foot height.
 */
export function fitGroundLine(
  points: readonly Point[],
  legLength: number,
  config: AnalysisConfig,
): LineFit | null {
  if (points.length < 2 || !(legLength > 0)) return null;
  const e = config.events;
  const bins = new Map<number, Point[]>();
  for (const p of points) {
    const key = Math.floor(p.x / legLength);
    const bin = bins.get(key) ?? [];
    bin.push(p);
    bins.set(key, bin);
  }
  const candidates: Point[] = [];
  for (const bin of bins.values()) {
    const cut = quantile(
      bin.map((p) => p.y),
      1 - e.groundLowestShare,
    );
    for (const p of bin) if (p.y >= cut) candidates.push(p);
  }
  const band = e.groundInlierLeg * legLength;
  const random = seededRandom(0x5eed);
  let best: { inliers: Point[]; residual: number } | null = null;
  for (let iter = 0; iter < e.groundRansacIterations && candidates.length >= 2; iter++) {
    const p = candidates[Math.floor(random() * candidates.length)];
    const q = candidates[Math.floor(random() * candidates.length)];
    if (!p || !q || Math.abs(q.x - p.x) < 0.5 * legLength) continue;
    const b = (q.y - p.y) / (q.x - p.x);
    if (Math.abs(b) > e.groundMaxSlope) continue;
    const a = p.y - b * p.x;
    const inliers: Point[] = [];
    let residual = 0;
    for (const c of candidates) {
      const r = Math.abs(c.y - (a + b * c.x));
      if (r <= band) {
        inliers.push(c);
        residual += r;
      }
    }
    if (
      !best ||
      inliers.length > best.inliers.length ||
      (inliers.length === best.inliers.length && residual < best.residual)
    ) {
      best = { inliers, residual };
    }
  }
  if (best && best.inliers.length >= 2) {
    const refit = linearFit(
      best.inliers.map((p) => p.x),
      best.inliers.map((p) => p.y),
    );
    if (refit && Math.abs(refit.b) <= e.groundMaxSlope) return refit;
  }
  const level = quantile(
    points.map((p) => p.y),
    0.95,
  );
  return Number.isFinite(level) ? { a: level, b: 0, n: points.length } : null;
}

export interface FootTraces {
  /** Contact-point speed in leg lengths per second. */
  speedLeg: Float64Array;
  /** Contact-point height above the ground line in leg lengths. */
  heightLeg: Float64Array;
  /** 1 where the frame satisfies both stance conditions. */
  stance: Uint8Array;
}

export interface StanceRun {
  side: Side;
  /** Track sample indices of the first and last stance sample. */
  start: number;
  end: number;
  /** True when the run reaches the end of the data, so toe-off was not seen. */
  openEnd: boolean;
}

export interface EventDetection {
  events: StanceEvent[];
  ground: LineFit | null;
  traces: Record<Side, FootTraces>;
  primaryRuns: StanceRun[];
  secondary: Record<Side, { icCandidates: number[]; toCandidates: number[] }>;
  /** Consecutive events (by initial contact) on the same side. */
  alternationBreaks: number;
}

function sampleTime(track: Track, k: number): number {
  return track.times[k] ?? NaN;
}

function footTraces(
  track: Track,
  side: Side,
  ground: LineFit | null,
  legLength: number,
  config: AnalysisConfig,
): FootTraces {
  const n = track.frameCount;
  const speedLeg = new Float64Array(n).fill(NaN);
  const heightLeg = new Float64Array(n).fill(NaN);
  const stance = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const cp = contactPoint(track, side, k);
    if (!cp || !ground) continue;
    speedLeg[k] = landmarkSpeed(track, cp.landmark, k) / legLength;
    heightLeg[k] = (ground.a + ground.b * cp.x - cp.y) / legLength;
    const speed = speedLeg[k] ?? NaN;
    const height = heightLeg[k] ?? NaN;
    if (speed < config.events.stanceSpeedLegPerSec && height < config.events.groundBandLeg)
      stance[k] = 1;
  }
  return { speedLeg, heightLeg, stance };
}

/** Primary method: runs of stance frames, merged across one-frame breaks and filtered by duration. */
export function stanceRuns(
  track: Track,
  side: Side,
  traces: FootTraces,
  config: AnalysisConfig,
): StanceRun[] {
  const e = config.events;
  const n = track.frameCount;
  const raw: { start: number; end: number }[] = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const on = k < n && traces.stance[k] === 1;
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      raw.push({ start, end: k - 1 });
      start = -1;
    }
  }
  const merged: { start: number; end: number }[] = [];
  for (const run of raw) {
    const last = merged[merged.length - 1];
    const gap = last ? run.start - last.end - 1 : Infinity;
    // Merge only across frames that have data, so a tracking gap does not join two stances.
    let gapHasData = true;
    if (last) {
      for (let k = last.end + 1; k < run.start; k++) {
        if (!Number.isFinite(traces.speedLeg[k] ?? NaN)) gapHasData = false;
      }
    }
    if (last && gap < e.mergeGapFrames && gapHasData) last.end = run.end;
    else merged.push({ ...run });
  }
  const hasData = (k: number) => k >= 0 && k < n && Number.isFinite(traces.speedLeg[k] ?? NaN);
  const runs: StanceRun[] = [];
  for (const run of merged) {
    // The frame before initial contact must be a measured non-stance frame, otherwise the
    // stance may have started before the data did and the initial contact time is unknown.
    if (!hasData(run.start - 1)) continue;
    const openEnd = !hasData(run.end + 1);
    const durationMs = (sampleTime(track, run.end) - sampleTime(track, run.start)) * 1000;
    if (durationMs < e.minStanceMs) continue;
    if (!openEnd && durationMs > e.maxStanceMs) continue;
    runs.push({ side, start: run.start, end: run.end, openEnd });
  }
  return runs;
}

/**
 * Local extrema of `series` that are the most extreme within the minimum separation and stand
 * out from their surroundings by at least `prominence`.
 */
export function findExtrema(
  series: Float64Array,
  times: Float64Array,
  minSeparationSec: number,
  prominence: number,
  kind: 'max' | 'min',
): number[] {
  const sign = kind === 'max' ? 1 : -1;
  const n = series.length;
  const candidates: number[] = [];
  for (let k = 0; k < n; k++) {
    const value = series[k] ?? NaN;
    const t = times[k] ?? NaN;
    if (!Number.isFinite(value) || !Number.isFinite(t)) continue;
    let isExtreme = true;
    let lowestLeft = value;
    let lowestRight = value;
    let seenLeft = false;
    let seenRight = false;
    for (let j = k - 1; j >= 0 && t - (times[j] ?? -Infinity) <= minSeparationSec; j--) {
      const v = series[j] ?? NaN;
      if (!Number.isFinite(v)) continue;
      seenLeft = true;
      if (sign * v > sign * value) isExtreme = false;
      if (sign * v < sign * lowestLeft) lowestLeft = v;
    }
    for (let j = k + 1; j < n && (times[j] ?? Infinity) - t <= minSeparationSec; j++) {
      const v = series[j] ?? NaN;
      if (!Number.isFinite(v)) continue;
      seenRight = true;
      if (sign * v >= sign * value) isExtreme = false;
      if (sign * v < sign * lowestRight) lowestRight = v;
    }
    if (!isExtreme || !seenLeft || !seenRight) continue;
    const prom = Math.min(sign * (value - lowestLeft), sign * (value - lowestRight));
    if (prom >= prominence) candidates.push(k);
  }
  return candidates;
}

/** Secondary method (Zeni): foot position relative to the mid-hip. Peaks are IC, troughs TO. */
function zeniCandidates(track: Track, side: Side, legLength: number, config: AnalysisConfig) {
  const s = SIDE_LANDMARKS[side];
  const n = track.frameCount;
  const heelRel = new Float64Array(n).fill(NaN);
  const toeRel = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const m = midHip(track, k);
    if (!m) continue;
    const heel = landmarkAt(track, s.heel, k);
    const toe = landmarkAt(track, s.footIndex, k);
    if (heel) heelRel[k] = heel.x - m.x;
    if (toe) toeRel[k] = toe.x - m.x;
  }
  const sep = config.events.zeniMinSeparationMs / 1000;
  const prom = config.events.zeniProminenceLeg * legLength;
  return {
    icCandidates: findExtrema(heelRel, track.times, sep, prom, 'max'),
    toCandidates: findExtrema(toeRel, track.times, sep, prom, 'min'),
  };
}

function nearest(
  candidates: readonly number[],
  used: Set<number>,
  track: Track,
  target: number,
  toleranceSec: number,
): number | null {
  let best: number | null = null;
  let bestDt = Infinity;
  const t = sampleTime(track, target);
  for (const c of candidates) {
    if (used.has(c)) continue;
    const dt = Math.abs(sampleTime(track, c) - t);
    if (dt <= toleranceSec && dt < bestDt) {
      best = c;
      bestDt = dt;
    }
  }
  return best;
}

/**
 * Detects stance events on both sides. The primary method gives the event times; the secondary
 * method is a cross-check (`agreement`), and contributes `secondary-only` events where the
 * primary method saw nothing. Frame numbers in the events are decoded-frame indices.
 */
export function detectEvents(
  track: Track,
  legLength: number,
  config: AnalysisConfig,
  frameStep: number,
): EventDetection {
  const e = config.events;
  const footPoints: Point[] = [];
  for (const side of SIDES) {
    for (let k = 0; k < track.frameCount; k++) {
      const cp = contactPoint(track, side, k);
      if (cp) footPoints.push(cp);
    }
  }
  const ground = fitGroundLine(footPoints, legLength, config);
  const traces = {
    left: footTraces(track, 'left', ground, legLength, config),
    right: footTraces(track, 'right', ground, legLength, config),
  };
  const secondary = {
    left: zeniCandidates(track, 'left', legLength, config),
    right: zeniCandidates(track, 'right', legLength, config),
  };
  const primaryRuns: StanceRun[] = [];
  const events: StanceEvent[] = [];
  const toFrame = (k: number) => k * frameStep;

  for (const side of SIDES) {
    const runs = stanceRuns(track, side, traces[side], config);
    primaryRuns.push(...runs);
    const usedIc = new Set<number>();
    const usedTo = new Set<number>();
    for (const run of runs) {
      const ic = nearest(
        secondary[side].icCandidates,
        usedIc,
        track,
        run.start,
        e.icToleranceMs / 1000,
      );
      if (ic !== null) usedIc.add(ic);
      let toAgrees = true;
      if (!run.openEnd) {
        const to = nearest(
          secondary[side].toCandidates,
          usedTo,
          track,
          run.end,
          e.toToleranceMs / 1000,
        );
        if (to !== null) usedTo.add(to);
        toAgrees = to !== null;
      }
      events.push({
        side,
        icFrame: toFrame(run.start),
        toFrame: run.openEnd ? null : toFrame(run.end),
        icTimeSec: sampleTime(track, run.start),
        toTimeSec: run.openEnd ? null : sampleTime(track, run.end),
        agreement: ic !== null && toAgrees ? 'both' : 'primary-only',
      });
    }
    // Secondary-only stances: an unmatched IC peak followed by a TO trough within the stance
    // duration limits, not overlapping any primary stance of this side.
    for (const ic of secondary[side].icCandidates) {
      if (usedIc.has(ic)) continue;
      const tIc = sampleTime(track, ic);
      const to = secondary[side].toCandidates.find((c) => {
        const ms = (sampleTime(track, c) - tIc) * 1000;
        return !usedTo.has(c) && ms >= e.minStanceMs && ms <= e.maxStanceMs;
      });
      if (to === undefined) continue;
      const overlaps = runs.some((r) => r.start <= to && ic <= r.end);
      if (overlaps) continue;
      usedTo.add(to);
      events.push({
        side,
        icFrame: toFrame(ic),
        toFrame: toFrame(to),
        icTimeSec: tIc,
        toTimeSec: sampleTime(track, to),
        agreement: 'secondary-only',
      });
    }
  }

  events.sort((a, b) => a.icTimeSec - b.icTimeSec);
  let alternationBreaks = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i]?.side === events[i - 1]?.side) alternationBreaks++;
  }
  return { events, ground, traces, primaryRuns, secondary, alternationBreaks };
}
