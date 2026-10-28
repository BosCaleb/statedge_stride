import type { Roi } from '@stride/analysis/types';

/**
 * A small grayscale thumbnail of a frame, for the camera-stability check. Pixels inside `mask`
 * (the athlete's box, full-frame pixels) are replaced by the mean of the rest so that a moving
 * athlete does not look like a moving camera. Works on the main thread and in workers.
 */
export function grayscaleSignature(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mask: Roi | null = null,
): Float32Array<ArrayBuffer> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Float32Array(width * height);
  const sx = width / sourceWidth;
  const sy = height / sourceHeight;
  const m = mask
    ? {
        x0: mask.x * sx,
        y0: mask.y * sy,
        x1: (mask.x + mask.width) * sx,
        y1: (mask.y + mask.height) * sy,
      }
    : null;
  const inMask = (x: number, y: number) =>
    m !== null && x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < out.length; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const v = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    out[i] = v;
    if (!inMask(i % width, Math.floor(i / width))) {
      sum += v;
      count++;
    }
  }
  if (m) {
    const fill = count > 0 ? sum / count : 0;
    for (let i = 0; i < out.length; i++)
      if (inMask(i % width, Math.floor(i / width))) out[i] = fill;
  }
  return out;
}
