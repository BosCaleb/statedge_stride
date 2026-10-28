import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import { timingStats } from '@stride/analysis/timebase';
import type { Outcome } from '@stride/analysis/types';
import { probeClip, type ClipProbe, type ProbeError } from './probe';

// The facts a coach sees about a clip before analysing it (import and device check): read from
// the container, without decoding any video.

export interface ClipFacts {
  probe: ClipProbe;
  /** 1 / the median frame interval in the file, or null with fewer than two frames. */
  fileFps: number | null;
  /** Share of frame intervals more than the tolerance away from the median. */
  irregularShare: number | null;
}

export async function readClipFacts(
  file: Blob,
  config: AnalysisConfig,
): Promise<Outcome<ClipFacts, ProbeError>> {
  const probed = await probeClip(file);
  if (!probed.ok) return probed;
  const timing = timingStats(probed.value.containerTimesSec, config.gate.timing.intervalTolerance);
  return {
    ok: true,
    value: {
      probe: probed.value,
      fileFps: Number.isFinite(timing.impliedFps) ? timing.impliedFps : null,
      irregularShare: Number.isFinite(timing.irregularShare) ? timing.irregularShare : null,
    },
  };
}
