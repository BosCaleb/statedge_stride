import { describe, expect, it } from 'vitest';
import { fft, phaseCorrelation, shiftInFramePixels, toThumbnail } from './stability';
import { seededRandom } from './stats';

/** A textured test scene (smooth random blobs) sampled with a sub-pixel offset. */
function scene(width: number, height: number, dx: number, dy: number): Float32Array {
  const random = seededRandom(42);
  const blobs = Array.from({ length: 60 }, () => ({
    x: random() * width,
    y: random() * height,
    r: 3 + random() * 10,
    a: random() * 200,
  }));
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (const b of blobs) {
        const d2 = (x - dx - b.x) ** 2 + (y - dy - b.y) ** 2;
        v += b.a * Math.exp(-d2 / (2 * b.r * b.r));
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

describe('fft', () => {
  it('inverts itself', () => {
    const re = Float64Array.from([1, 2, 3, 4, 0, -1, 5, 2]);
    const im = new Float64Array(8);
    const original = Float64Array.from(re);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 8; i++) {
      expect(re[i]).toBeCloseTo(original[i] ?? 0, 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });
});

describe('phaseCorrelation', () => {
  const w = 256;
  const h = 144;

  it('finds no shift between identical frames', () => {
    const a = scene(w, h, 0, 0);
    const s = phaseCorrelation(a, a, w, h);
    expect(Math.hypot(s.dx, s.dy)).toBeLessThan(0.05);
  });

  it.each([
    [3, 0],
    [-2, 4],
    [0.5, -0.25],
    [1.4, 0.7],
  ])('recovers a shift of (%f, %f) thumbnail pixels', (dx, dy) => {
    const a = scene(w, h, 0, 0);
    const b = scene(w, h, dx, dy);
    const s = phaseCorrelation(a, b, w, h);
    // 0.15 thumbnail pixels is about 1 full-resolution pixel at 1920 wide.
    expect(Math.abs(s.dx - dx)).toBeLessThan(0.15);
    expect(Math.abs(s.dy - dy)).toBeLessThan(0.15);
  });

  it('ignores a moving athlete inside the masked box', () => {
    const a = scene(w, h, 0, 0);
    const b = scene(w, h, 0, 0);
    // Paint a bright "athlete" in different places in the two frames.
    for (let y = 40; y < 110; y++) for (let x = 60; x < 90; x++) a[y * w + x] = 5000;
    for (let y = 40; y < 110; y++) for (let x = 140; x < 170; x++) b[y * w + x] = 5000;
    const s = phaseCorrelation(a, b, w, h, [
      { x: 55, y: 35, width: 40, height: 80 },
      { x: 135, y: 35, width: 40, height: 80 },
    ]);
    expect(Math.hypot(s.dx, s.dy)).toBeLessThan(0.3);
  });

  it('maps a full-frame box to thumbnail pixels', () => {
    const box = toThumbnail({ x: 960, y: 540, width: 192, height: 108 }, 1920, 1080, 256, 144);
    expect(box.x).toBeCloseTo(128, 9);
    expect(box.y).toBeCloseTo(72, 9);
    expect(box.width).toBeCloseTo(25.6, 9);
    expect(box.height).toBeCloseTo(14.4, 9);
  });

  it('converts to full-resolution pixels', () => {
    expect(shiftInFramePixels({ dx: 3, dy: 4, peak: 1 }, 256, 1920)).toBeCloseTo(37.5, 9);
  });
});
