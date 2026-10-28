import { describe, expect, it } from 'vitest';
import { decodeSkp1, encodeSkp1, readSkp1Header, skp1ByteLength, SKP1_HEADER_BYTES } from './skp1';
import { seededRandom } from './stats';
import { LANDMARK_COUNT, type Landmark } from './types';

function randomFrames(n: number, width: number, height: number, seed: number) {
  const random = seededRandom(seed);
  const frames: (Landmark[] | null)[] = [];
  for (let f = 0; f < n; f++) {
    if (random() < 0.05) {
      frames.push(null);
      continue;
    }
    frames.push(
      Array.from({ length: LANDMARK_COUNT }, () =>
        random() < 0.03
          ? { x: NaN, y: NaN, v: 0 }
          : { x: random() * width, y: random() * height, v: 0.05 + 0.95 * random() },
      ),
    );
  }
  return frames;
}

describe('SKP1 keypoint files', () => {
  it('round-trips a random pose sequence with less than one pixel of error', () => {
    const width = 1920;
    const height = 1080;
    const frames = randomFrames(1200, width, height, 99);
    const timesSec = Array.from({ length: frames.length }, (_, i) => i / 240);
    const bytes = encodeSkp1({
      widthPx: width,
      heightPx: height,
      mirrored: true,
      timesSec,
      frames,
    });
    expect(bytes.byteLength).toBe(skp1ByteLength(1200));
    // About 200 KB for a 1,200-frame clip, as the specification estimates.
    expect(bytes.byteLength).toBeGreaterThan(190_000);
    expect(bytes.byteLength).toBeLessThan(210_000);

    const decoded = decodeSkp1(bytes);
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.value.header.mirrored).toBe(true);
    expect(decoded.value.header.frameCount).toBe(1200);
    let maxError = 0;
    for (let f = 0; f < frames.length; f++) {
      expect(decoded.value.timesSec[f]).toBeCloseTo(timesSec[f] ?? 0, 5);
      const original = frames[f];
      const back = decoded.value.frames[f];
      if (original === null || original === undefined) {
        expect(back).toBeNull();
        continue;
      }
      for (let l = 0; l < LANDMARK_COUNT; l++) {
        const a = original[l] as Landmark;
        const b = back?.[l] as Landmark;
        if (!Number.isFinite(a.x)) {
          expect(b.v).toBe(0);
          continue;
        }
        maxError = Math.max(maxError, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        expect(Math.abs(a.v - b.v)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      }
    }
    expect(maxError).toBeLessThan(1);
  });

  it('stores coordinates outside the frame clamped to its edge', () => {
    const frames = [Array.from({ length: LANDMARK_COUNT }, () => ({ x: -20, y: 2000, v: 0.9 }))];
    const decoded = decodeSkp1(
      encodeSkp1({ widthPx: 100, heightPx: 100, mirrored: false, timesSec: [0], frames }),
    );
    if (!decoded.ok) throw new Error(decoded.reason);
    const lm = decoded.value.frames[0]?.[0];
    expect(lm?.x).toBe(0);
    expect(lm?.y).toBeCloseTo(100, 0);
  });

  it('rejects files that are not SKP1 or whose size does not match the header', () => {
    expect(readSkp1Header(new Uint8Array(3))).toEqual({ ok: false, reason: 'too_short' });
    const good = encodeSkp1({
      widthPx: 640,
      heightPx: 480,
      mirrored: false,
      timesSec: [0, 0.1],
      frames: [null, null],
    });
    const bad = good.slice();
    bad[0] = 0x41;
    expect(readSkp1Header(bad)).toEqual({ ok: false, reason: 'bad_magic' });
    const version = good.slice();
    version[4] = 2;
    expect(readSkp1Header(version)).toEqual({ ok: false, reason: 'unsupported_version' });
    expect(readSkp1Header(good.slice(0, good.byteLength - 1))).toEqual({
      ok: false,
      reason: 'size_mismatch',
    });
    const landmarks = good.slice();
    landmarks[10] = 17;
    expect(readSkp1Header(landmarks)).toEqual({ ok: false, reason: 'bad_landmark_count' });
    expect(good.byteLength).toBe(SKP1_HEADER_BYTES + 2 * 4 + 2 * 33 * 5);
  });

  it('requires one timestamp per frame', () => {
    expect(() =>
      encodeSkp1({
        widthPx: 10,
        heightPx: 10,
        mirrored: false,
        timesSec: [0],
        frames: [null, null],
      }),
    ).toThrow();
  });
});
