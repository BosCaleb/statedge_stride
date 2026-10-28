import { defaultConfig } from '@stride/analysis/config';
import { describe, expect, it } from 'vitest';
import { describePhone, evaluateDeviceClip, RETIMED } from './deviceCheck';

const times = (n: number, fps: number, jitter = 0) =>
  Float64Array.from({ length: n }, (_v, i) => i / fps + (i % 2 === 0 ? 0 : jitter));

const clip = (overrides: Partial<Parameters<typeof evaluateDeviceClip>[0]> = {}) => ({
  containerTimesSec: times(1200, 240),
  widthPx: 1920,
  heightPx: 1080,
  durationSec: 5,
  decodable: true,
  declaredFps: 240,
  ...overrides,
});

describe('device check', () => {
  it('passes a regular 240 fps 1080p clip of a few seconds', () => {
    const outcome = evaluateDeviceClip(clip(), defaultConfig);
    expect(outcome).toMatchObject({ result: 'pass', reasons: [], retimed: false });
    expect(outcome.fileFps).toBeCloseTo(240, 6);
    expect(outcome.timingJitter).toBeCloseTo(0, 6);
  });

  it('is conditional for a file re-timed for playback: its real timing cannot be checked', () => {
    const outcome = evaluateDeviceClip(
      clip({ containerTimesSec: times(1200, 30), durationSec: 40 }),
      defaultConfig,
    );
    expect(outcome.retimed).toBe(true);
    expect(outcome.captureFps).toBe(240);
    expect(outcome.fileFps).toBeCloseTo(30, 6);
    // 40 s of playback is over the warning length as well.
    expect(outcome.result).toBe('fail');
    expect(outcome.reasons).toContain(RETIMED);
  });

  it('warns below 1080p and fails a clip that cannot be decoded', () => {
    expect(evaluateDeviceClip(clip({ widthPx: 1280, heightPx: 720 }), defaultConfig)).toMatchObject(
      {
        result: 'conditional',
        reasons: ['resolution_ok'],
      },
    );
    expect(evaluateDeviceClip(clip({ decodable: false }), defaultConfig)).toMatchObject({
      result: 'fail',
      reasons: ['codec_decodable'],
    });
  });

  it('fails normal video at 30 fps when the coach says so', () => {
    const outcome = evaluateDeviceClip(
      clip({ containerTimesSec: times(150, 30), declaredFps: 30 }),
      defaultConfig,
    );
    expect(outcome.result).toBe('fail');
    expect(outcome.reasons).toContain('fps_ok');
  });

  it('measures irregular frame timing', () => {
    const outcome = evaluateDeviceClip(
      clip({ containerTimesSec: times(1200, 240, 0.0015) }),
      defaultConfig,
    );
    expect(outcome.timingJitter ?? 0).toBeCloseTo(0.36, 2);
    expect(outcome.reasons).toContain('timing_regular');
  });
});

describe('describing the phone', () => {
  it('reads Android, iPhone and desktop user agents', () => {
    expect(
      describePhone(
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ),
    ).toEqual({ model: 'SM-S918B', os: 'Android 14', browser: 'Chrome 141' });
    expect(
      describePhone(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ).model,
    ).toBeNull();
    expect(
      describePhone(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ model: 'iPhone', os: 'iOS 18.1', browser: 'Safari 18.1' });
    expect(
      describePhone(
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      ).browser,
    ).toBe('Samsung Internet 26');
  });
});
