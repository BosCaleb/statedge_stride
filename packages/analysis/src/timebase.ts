import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import { median } from './stats';
import type { Outcome } from './types';

// The analysis time axis. Slow-motion files are often re-timed for playback (a 240 fps capture
// stored at 30 fps), so container timestamps are used only when they imply a high, regular rate.

export interface TimingStats {
  frames: number;
  medianIntervalSec: number;
  /** 1 / median interval. */
  impliedFps: number;
  /** Share of intervals more than the tolerance away from the median. */
  irregularShare: number;
  /** Intervals larger than 1.5 times the median, counted as dropped frames. */
  droppedFrames: number;
  intervalsSec: Float64Array;
}

export function timingStats(timesSec: ArrayLike<number>, intervalTolerance: number): TimingStats {
  const n = timesSec.length;
  const intervals = new Float64Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) intervals[i - 1] = (timesSec[i] ?? NaN) - (timesSec[i - 1] ?? NaN);
  const med = median(intervals);
  let irregular = 0;
  let dropped = 0;
  for (const dt of intervals) {
    if (!(Math.abs(dt - med) <= intervalTolerance * med)) irregular++;
    if (dt > 1.5 * med) dropped++;
  }
  return {
    frames: n,
    medianIntervalSec: med,
    impliedFps: med > 0 ? 1 / med : NaN,
    irregularShare: intervals.length > 0 ? irregular / intervals.length : NaN,
    droppedFrames: dropped,
    intervalsSec: intervals,
  };
}

export interface Timebase {
  source: 'container' | 'declared';
  /** Capture rate used for the analysis. */
  fps: number;
  /** Analysis time of every decoded frame, seconds from the first frame. */
  timesSec: Float64Array;
  stats: TimingStats;
}

/**
 * Uses the container timestamps when they imply at least `minContainerFps` with low jitter;
 * otherwise index / declaredFps. Fails with timing_invalid when neither is plausible.
 */
export function chooseTimebase(
  containerTimesSec: ArrayLike<number>,
  declaredFps: number,
  config: AnalysisConfig,
): Outcome<Timebase, 'timing_invalid'> {
  const stats = timingStats(containerTimesSec, config.gate.timing.intervalTolerance);
  const n = containerTimesSec.length;
  const t = config.timebase;
  if (
    stats.impliedFps >= t.minContainerFps &&
    stats.irregularShare <= t.maxContainerIrregularShare
  ) {
    const first = containerTimesSec[0] ?? 0;
    const timesSec = new Float64Array(n);
    for (let i = 0; i < n; i++) timesSec[i] = (containerTimesSec[i] ?? NaN) - first;
    return { ok: true, value: { source: 'container', fps: stats.impliedFps, timesSec, stats } };
  }
  if (declaredFps >= t.declaredFps.min && declaredFps <= t.declaredFps.max) {
    const timesSec = new Float64Array(n);
    for (let i = 0; i < n; i++) timesSec[i] = i / declaredFps;
    return { ok: true, value: { source: 'declared', fps: declaredFps, timesSec, stats } };
  }
  return { ok: false, reason: 'timing_invalid' };
}
