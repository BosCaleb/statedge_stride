// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { probeClip, rotationFromMatrix } from './probe';

const dir = fileURLToPath(new URL('../../../../fixtures/clips/probe/', import.meta.url));
const clip = (name: string) => new Blob([readFileSync(dir + name)]);

describe('probeClip', () => {
  it.each(['h264-240fps-faststart.mp4', 'h264-240fps-moov-end.mp4'])(
    'reads codec, size and every timestamp of %s',
    async (name) => {
      const probe = await probeClip(clip(name));
      if (!probe.ok) throw new Error(probe.reason);
      const p = probe.value;
      expect(p.codec).toMatch(/^avc1\./);
      expect([p.widthPx, p.heightPx]).toEqual([320, 180]);
      expect(p.rotation).toBe(0);
      expect(p.frameCount).toBe(120);
      expect(p.containerTimesSec).toHaveLength(120);
      expect(p.containerTimesSec[1]! - p.containerTimesSec[0]!).toBeCloseTo(1 / 240, 6);
      expect(p.durationSec).toBeCloseTo(0.5, 2);
      expect(p.description?.byteLength).toBeGreaterThan(8);
    },
  );

  it('reads VP9 and HEVC clips with their decoder configuration', async () => {
    for (const [name, prefix] of [
      ['vp9-240fps.mp4', /^vp09\./],
      ['hevc-240fps.mp4', /^hvc1\./],
    ] as const) {
      const probe = await probeClip(clip(name));
      if (!probe.ok) throw new Error(probe.reason);
      expect(probe.value.codec).toMatch(prefix);
      expect(probe.value.frameCount).toBe(120);
      expect(probe.value.description).not.toBeNull();
    }
  });

  it('keeps the container timing of a re-timed slow-motion file', async () => {
    const probe = await probeClip(clip('h264-retimed-30fps.mp4'));
    if (!probe.ok) throw new Error(probe.reason);
    expect(probe.value.frameCount).toBe(120);
    expect(probe.value.containerTimesSec[1]! - probe.value.containerTimesSec[0]!).toBeCloseTo(
      1 / 30,
      6,
    );
  });

  it('reports the display rotation and the displayed size', async () => {
    const probe = await probeClip(clip('h264-rotate90.mp4'));
    if (!probe.ok) throw new Error(probe.reason);
    expect([90, 270]).toContain(probe.value.rotation);
    expect([probe.value.widthPx, probe.value.heightPx]).toEqual([180, 320]);
    expect([probe.value.codedWidth, probe.value.codedHeight]).toEqual([320, 180]);
  });

  it('rejects a file that is not MP4', async () => {
    const probe = await probeClip(new Blob([new Uint8Array(5000).fill(7)]));
    expect(probe).toEqual({ ok: false, reason: 'not_mp4' });
  });
});

describe('rotationFromMatrix', () => {
  it('reads 16.16 fixed-point matrices', () => {
    expect(rotationFromMatrix([65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824])).toBe(0);
    expect(rotationFromMatrix([0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824])).toBe(90);
    expect(rotationFromMatrix([-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824])).toBe(180);
    expect(rotationFromMatrix([0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824])).toBe(270);
  });
});
