import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { CalibrationSummary } from '@stride/shared/analysisResult';
import type { Mode } from '@stride/shared/enums';
import { defaultAnalysisConfig } from '../config';
import { clipChecks } from '../gate';
import { analyse, type AnalysisOutput } from '../pipeline';
import { timingStats } from '../timebase';
import type { SyntheticClip } from './syntheticGait';

export interface SyntheticRunOptions {
  mode?: Mode;
  config?: AnalysisConfig;
  /** Defaults to a calibration that matches the generator's pxPerM. */
  calibration?: CalibrationSummary | null;
  pxPerM?: number;
  cameraShiftPx?: number | null;
}

/** Runs a synthetic clip through the pure pipeline with realistic clip-level checks. */
export function runSynthetic(
  clip: SyntheticClip,
  options: SyntheticRunOptions = {},
): AnalysisOutput {
  const config = options.config ?? defaultAnalysisConfig();
  const mode = options.mode ?? 'distance';
  const pxPerM = options.pxPerM ?? 150;
  const calibration =
    options.calibration === undefined
      ? {
          markerA: { x: 400, y: 900 },
          markerB: { x: 400 + 5 * pxPerM, y: 900 },
          distanceM: 5,
          pxPerM,
        }
      : options.calibration;
  const stats = timingStats(clip.timesSec, config.gate.timing.intervalTolerance);
  const frameStep = config.metrics.frameStep[mode];
  const checks = clipChecks(
    {
      decodable: true,
      effectiveFps: clip.clip.declaredFps / frameStep,
      mode,
      irregularShare: stats.irregularShare,
      widthPx: clip.clip.widthPx,
      heightPx: clip.clip.heightPx,
      durationSec: clip.clip.durationSec,
      calibrationPresent: calibration !== null,
      athleteSelected: true,
      cameraShiftPx: options.cameraShiftPx === undefined ? 0.5 : options.cameraShiftPx,
    },
    config.gate,
  );
  return analyse({
    frames: clip.frames,
    clip: clip.clip,
    timesSec: clip.timesSec,
    timebase: 'container',
    captureFps: clip.clip.declaredFps,
    frameStep,
    mode,
    calibration,
    clipChecks: checks,
    poseModel: { id: 'synthetic', version: '1' },
    config,
    createdAt: '2026-10-28T12:00:00.000Z',
  });
}
