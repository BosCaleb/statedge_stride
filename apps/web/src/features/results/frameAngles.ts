import {
  angleFromDownVertical,
  angleFromUpVertical,
  interiorAngle,
  midpoint,
} from '@stride/analysis/geometry';
import { LM, SIDE_LANDMARKS, type Landmark, type Point } from '@stride/analysis/types';
import type { Side } from '@stride/shared/enums';

// Joint angles at the frame shown in the viewer, from that frame's landmarks, with the same
// definitions as the metrics: forward is the direction of travel. Null where a landmark needed
// is missing or unclear.

export interface FrameAngles {
  /** 180 minus the interior angle hip, knee, ankle: 0 is a straight leg. */
  knee: Record<Side, number | null>;
  /** 180 minus the interior angle shoulder, hip, knee. */
  hip: Record<Side, number | null>;
  /** Knee to ankle against vertical, positive when the ankle is ahead of the knee. */
  shin: Record<Side, number | null>;
  /** Mid-hip to mid-shoulder against vertical, positive when leaning forward. */
  trunkLean: number | null;
}

export function frameAngles(
  landmarks: readonly Landmark[] | null | undefined,
  direction: 1 | -1,
  minVisibility: number,
): FrameAngles {
  const at = (index: number): Point | null => {
    const l = landmarks?.[index];
    if (!l || l.v < minVisibility || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
    return { x: l.x * direction, y: l.y };
  };
  const finite = (v: number) => (Number.isFinite(v) ? v : null);
  const side = (s: Side) => {
    const ids = SIDE_LANDMARKS[s];
    const shoulder = at(ids.shoulder);
    const hip = at(ids.hip);
    const knee = at(ids.knee);
    const ankle = at(ids.ankle);
    return {
      knee: hip && knee && ankle ? finite(180 - interiorAngle(hip, knee, ankle)) : null,
      hip: shoulder && hip && knee ? finite(180 - interiorAngle(shoulder, hip, knee)) : null,
      shin: knee && ankle ? finite(angleFromDownVertical(knee, ankle)) : null,
    };
  };
  const left = side('left');
  const right = side('right');
  const ls = at(LM.leftShoulder);
  const rs = at(LM.rightShoulder);
  const lh = at(LM.leftHip);
  const rh = at(LM.rightHip);
  const trunkLean =
    ls && rs && lh && rh ? finite(angleFromUpVertical(midpoint(lh, rh), midpoint(ls, rs))) : null;
  return {
    knee: { left: left.knee, right: right.knee },
    hip: { left: left.hip, right: right.hip },
    shin: { left: left.shin, right: right.shin },
    trunkLean,
  };
}
