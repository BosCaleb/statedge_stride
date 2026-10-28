import { analysisConfigSchema } from '@stride/shared/analysisConfig';
import { METRIC_IDS } from '@stride/shared/enums';
import { describe, expect, it } from 'vitest';
import { ALGORITHM_VERSION, defaultAnalysisConfig, defaultConfig } from './config';

/**
 * The configuration fingerprint recorded for each algorithm version. When a configuration value
 * changes, this test fails: bump ALGORITHM_VERSION in config.ts and record the new fingerprint.
 */
const CONFIG_FINGERPRINTS: Record<string, string> = {
  '0.1.0': '61057c21',
};

/** FNV-1a 32-bit hash of the canonical JSON. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe('analysis configuration', () => {
  it('matches the shared schema', () => {
    expect(analysisConfigSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });

  it('is versioned: a changed value needs a new algorithm version', () => {
    expect(
      fingerprint(defaultConfig),
      `bump ALGORITHM_VERSION and record ${fingerprint(defaultConfig)}`,
    ).toBe(CONFIG_FINGERPRINTS[ALGORITHM_VERSION]);
  });

  it('is frozen, and the copy is mutable and independent', () => {
    expect(Object.isFrozen(defaultConfig.gate.fps)).toBe(true);
    const copy = defaultAnalysisConfig();
    copy.gate.fps.failBelow = 1;
    expect(defaultConfig.gate.fps.failBelow).toBe(100);
  });

  it('lists only known metrics by mode, each once', () => {
    for (const mode of ['sprint', 'distance'] as const) {
      const { primary, secondary } = defaultConfig.metrics.byMode[mode];
      const all = [...primary, ...secondary];
      expect(new Set(all).size).toBe(all.length);
      for (const id of all) expect(METRIC_IDS).toContain(id);
    }
  });

  it('keeps foot_angle_ic behind a feature flag that is off by default', () => {
    expect(defaultConfig.metrics.featureFlags.footAngleIc).toBe(false);
  });
});
