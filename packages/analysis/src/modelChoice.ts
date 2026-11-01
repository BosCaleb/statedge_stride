import type { AnalysisConfig } from '@stride/shared/analysisConfig';

// Which pose model a phone uses. The heavy model gives better landmarks for small or distant
// athletes; a phone uses it only when the device check timed it fast enough to keep a 5 s,
// 240 fps clip within the spec's 90 s. Without a measurement, the full model.

export type PoseModelChoice = 'full' | 'heavy';

export function choosePoseModel(
  heavyMsPerFrame: number | null,
  config: AnalysisConfig['poseModel'],
): PoseModelChoice {
  return heavyMsPerFrame !== null &&
    Number.isFinite(heavyMsPerFrame) &&
    heavyMsPerFrame <= config.heavyMaxMsPerFrame
    ? 'heavy'
    : 'full';
}
