import { LM, type Landmark } from '@stride/analysis/types';

/** Segments drawn for the skeleton overlay, by side. */
export const SKELETON_BONES: { a: number; b: number; side: 'left' | 'right' | 'centre' }[] = [
  { a: LM.leftShoulder, b: LM.rightShoulder, side: 'centre' },
  { a: LM.leftHip, b: LM.rightHip, side: 'centre' },
  { a: LM.leftShoulder, b: LM.leftElbow, side: 'left' },
  { a: LM.leftElbow, b: LM.leftWrist, side: 'left' },
  { a: LM.leftShoulder, b: LM.leftHip, side: 'left' },
  { a: LM.leftHip, b: LM.leftKnee, side: 'left' },
  { a: LM.leftKnee, b: LM.leftAnkle, side: 'left' },
  { a: LM.leftAnkle, b: LM.leftHeel, side: 'left' },
  { a: LM.leftHeel, b: LM.leftFootIndex, side: 'left' },
  { a: LM.leftAnkle, b: LM.leftFootIndex, side: 'left' },
  { a: LM.rightShoulder, b: LM.rightElbow, side: 'right' },
  { a: LM.rightElbow, b: LM.rightWrist, side: 'right' },
  { a: LM.rightShoulder, b: LM.rightHip, side: 'right' },
  { a: LM.rightHip, b: LM.rightKnee, side: 'right' },
  { a: LM.rightKnee, b: LM.rightAnkle, side: 'right' },
  { a: LM.rightAnkle, b: LM.rightHeel, side: 'right' },
  { a: LM.rightHeel, b: LM.rightFootIndex, side: 'right' },
  { a: LM.rightAnkle, b: LM.rightFootIndex, side: 'right' },
];

export interface SkeletonStyle {
  left: string;
  right: string;
  centre: string;
  lineWidth: number;
  minVisibility: number;
}

/**
 * Draws a skeleton in frame pixels scaled by `scale`. Left and right use different colours;
 * the viewer also labels the sides in text, so colour is never the only signal.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  landmarks: readonly Landmark[],
  scale: number,
  style: SkeletonStyle,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = style.lineWidth;
  for (const bone of SKELETON_BONES) {
    const a = landmarks[bone.a];
    const b = landmarks[bone.b];
    if (!a || !b || a.v < style.minVisibility || b.v < style.minVisibility) continue;
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    ctx.strokeStyle = style[bone.side];
    ctx.beginPath();
    ctx.moveTo(a.x * scale, a.y * scale);
    ctx.lineTo(b.x * scale, b.y * scale);
    ctx.stroke();
  }
  ctx.fillStyle = style.centre;
  for (const id of [
    LM.leftKnee,
    LM.rightKnee,
    LM.leftAnkle,
    LM.rightAnkle,
    LM.leftHip,
    LM.rightHip,
  ]) {
    const p = landmarks[id];
    if (!p || p.v < style.minVisibility || !Number.isFinite(p.x)) continue;
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, style.lineWidth * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
