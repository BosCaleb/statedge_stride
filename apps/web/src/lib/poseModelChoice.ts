import { defaultConfig } from '@stride/analysis/config';
import { choosePoseModel, type PoseModelChoice } from '@stride/analysis/modelChoice';
import { z } from 'zod';
import { readPreference, writePreference } from './storage';

// The heavy pose model's speed on this phone, as the device check measured it, and the model the
// phone therefore uses. Kept on the phone only: it describes the phone, not a person.

const KEY = 'stride.poseTiming';

const timingSchema = z.object({
  heavyMsPerFrame: z.number().nonnegative(),
  delegate: z.enum(['GPU', 'CPU']),
  measuredAt: z.iso.datetime(),
});
export type PoseTiming = z.infer<typeof timingSchema>;

export function readPoseTiming(): PoseTiming | null {
  const raw = readPreference(KEY);
  if (raw === null) return null;
  try {
    const parsed = timingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePoseTiming(timing: PoseTiming): void {
  writePreference(KEY, JSON.stringify(timing));
}

/** The pose model this phone uses: heavy only when it was measured fast enough. */
export function chosenPoseModel(): PoseModelChoice {
  return choosePoseModel(readPoseTiming()?.heavyMsPerFrame ?? null, defaultConfig.poseModel);
}
