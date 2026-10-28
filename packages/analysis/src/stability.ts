import type { Roi } from './types';

// Camera-stability check by phase correlation of small grayscale thumbnails. The DOM-bound
// runtime renders frames to thumbnails; everything here is pure arithmetic on Float32Arrays.

/** In-place iterative radix-2 complex FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const br = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const bi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - br;
        im[b] = (im[a] ?? 0) - bi;
        re[a] = (re[a] ?? 0) + br;
        im[a] = (im[a] ?? 0) + bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

function fft2d(re: Float64Array, im: Float64Array, size: number, inverse: boolean): void {
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  for (let y = 0; y < size; y++) {
    rowRe.set(re.subarray(y * size, (y + 1) * size));
    rowIm.set(im.subarray(y * size, (y + 1) * size));
    fft(rowRe, rowIm, inverse);
    re.set(rowRe, y * size);
    im.set(rowIm, y * size);
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      rowRe[y] = re[y * size + x] ?? 0;
      rowIm[y] = im[y * size + x] ?? 0;
    }
    fft(rowRe, rowIm, inverse);
    for (let y = 0; y < size; y++) {
      re[y * size + x] = rowRe[y] ?? 0;
      im[y * size + x] = rowIm[y] ?? 0;
    }
  }
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Prepares a thumbnail for correlation: pixels inside any of `masks` (athlete boxes, in thumbnail
 * pixels) take the mean of the rest, then a Hann window is applied and the image is zero-padded
 * to a square power of two. The same masks are applied to both images being compared.
 */
function prepare(
  image: Float32Array,
  width: number,
  height: number,
  size: number,
  masks: readonly Roi[],
): Float64Array {
  const inMask = (x: number, y: number) =>
    masks.some((m) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inMask(x, y)) continue;
      sum += image[y * width + x] ?? 0;
      count++;
    }
  }
  const fill = count > 0 ? sum / count : 0;
  const out = new Float64Array(size * size);
  for (let y = 0; y < height; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / Math.max(1, height - 1));
    for (let x = 0; x < width; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / Math.max(1, width - 1));
      const v = inMask(x, y) ? fill : (image[y * width + x] ?? 0);
      out[y * size + x] = (v - fill) * wx * wy;
    }
  }
  return out;
}

export interface Shift {
  /** Shift of `b` relative to `a`, in thumbnail pixels. */
  dx: number;
  dy: number;
  /** Height of the correlation peak, 0 to 1. Low values mean the images did not match. */
  peak: number;
}

/** Sub-sample peak offset from three samples: Gaussian fit, or parabolic if any is not positive. */
function peakOffset(left: number, centre: number, right: number): number {
  if (left > 0 && centre > 0 && right > 0) {
    const l = Math.log(left);
    const c = Math.log(centre);
    const r = Math.log(right);
    const denom = l - 2 * c + r;
    if (Math.abs(denom) > 1e-12) return Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom));
  }
  const denom = left - 2 * centre + right;
  return Math.abs(denom) < 1e-12
    ? 0
    : Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
}

/**
 * Phase correlation with sub-pixel peak refinement. The normalised cross-power spectrum is
 * weighted by a Gaussian before the inverse transform, which turns the sinc-shaped correlation
 * peak into a Gaussian one that a three-point fit locates to a fraction of a pixel.
 */
export function phaseCorrelation(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  masks: readonly Roi[] = [],
): Shift {
  const size = nextPowerOfTwo(Math.max(width, height));
  const aRe = prepare(a, width, height, size, masks);
  const bRe = prepare(b, width, height, size, masks);
  const aIm = new Float64Array(size * size);
  const bIm = new Float64Array(size * size);
  fft2d(aRe, aIm, size, false);
  fft2d(bRe, bIm, size, false);
  // Normalised cross-power spectrum B * conj(A) / |B * conj(A)|, Gaussian-weighted so that the
  // correlation peak has a spatial standard deviation of about 1.3 pixels.
  const sigma = size / 8;
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const ar = aRe[i] ?? 0;
    const ai = aIm[i] ?? 0;
    const br = bRe[i] ?? 0;
    const bi = bIm[i] ?? 0;
    const cr = br * ar + bi * ai;
    const ci = bi * ar - br * ai;
    const mag = Math.hypot(cr, ci);
    const fy = Math.floor(i / size);
    const fx = i % size;
    const wy = fy > size / 2 ? fy - size : fy;
    const wx = fx > size / 2 ? fx - size : fx;
    const weight = Math.exp(-(wx * wx + wy * wy) / (2 * sigma * sigma));
    re[i] = mag > 1e-12 ? (cr / mag) * weight : 0;
    im[i] = mag > 1e-12 ? (ci / mag) * weight : 0;
  }
  fft2d(re, im, size, true);
  let best = 0;
  for (let i = 1; i < size * size; i++) if ((re[i] ?? 0) > (re[best] ?? 0)) best = i;
  const py = Math.floor(best / size);
  const px = best % size;
  const at = (x: number, y: number) => re[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  const ox = peakOffset(at(px - 1, py), at(px, py), at(px + 1, py));
  const oy = peakOffset(at(px, py - 1), at(px, py), at(px, py + 1));
  const wrap = (v: number) => (v > size / 2 ? v - size : v);
  return { dx: wrap(px) + ox, dy: wrap(py) + oy, peak: at(px, py) };
}

/** Shift magnitude in full-resolution pixels. */
export function shiftInFramePixels(
  shift: Shift,
  thumbnailWidth: number,
  frameWidthPx: number,
): number {
  return Math.hypot(shift.dx, shift.dy) * (frameWidthPx / thumbnailWidth);
}

/** A full-frame box in thumbnail pixels. */
export function toThumbnail(
  box: Roi,
  frameWidthPx: number,
  frameHeightPx: number,
  width: number,
  height: number,
): Roi {
  const sx = width / frameWidthPx;
  const sy = height / frameHeightPx;
  return { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy };
}
