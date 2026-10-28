import { clipChecks } from '@stride/analysis/gate';
import { chooseTimebase, timingStats } from '@stride/analysis/timebase';
import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { GateCheck } from '@stride/shared/analysisResult';
import type { GateCheckId, GateStatus } from '@stride/shared/enums';

// The device check: whether a test clip from this phone can be analysed, judged by the same
// clip-level checks as the quality gate (decodable, frame rate, frame timing, resolution and
// length), in sprint mode because that needs the most. A file re-timed for playback (slow motion
// stored at 30 fps) is conditional: its real frame timing cannot be checked.

export const DEVICE_CHECK_IDS = [
  'codec_decodable',
  'fps_ok',
  'timing_regular',
  'resolution_ok',
  'duration_ok',
] as const satisfies readonly GateCheckId[];

/** Reason code for a re-timed file, beside the check ids. */
export const RETIMED = 'retimed_file';

export interface DeviceClip {
  containerTimesSec: ArrayLike<number>;
  widthPx: number;
  heightPx: number;
  durationSec: number;
  decodable: boolean;
  /** The frame rate the coach says the clip was filmed at. */
  declaredFps: number;
}

export interface DeviceOutcome {
  result: GateStatus;
  checks: GateCheck[];
  /** Check ids that warned or failed, and RETIMED; comma separated in the stored record. */
  reasons: string[];
  /** The frame rate the analysis would use. */
  captureFps: number | null;
  /** The rate in the file's own timestamps. */
  fileFps: number | null;
  irregularShare: number | null;
  /** Coefficient of variation of the frame intervals. */
  timingJitter: number | null;
  retimed: boolean;
}

function coefficientOfVariation(values: ArrayLike<number>): number | null {
  const n = values.length;
  if (n < 2) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i] ?? 0;
  const mean = sum / n;
  if (!(mean > 0)) return null;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += ((values[i] ?? 0) - mean) ** 2;
  return Math.sqrt(sq / (n - 1)) / mean;
}

export function evaluateDeviceClip(clip: DeviceClip, config: AnalysisConfig): DeviceOutcome {
  const timing = timingStats(clip.containerTimesSec, config.gate.timing.intervalTolerance);
  const timebase = chooseTimebase(clip.containerTimesSec, clip.declaredFps, config);
  const retimed = timebase.ok && timebase.value.source === 'declared';
  const checks = clipChecks(
    {
      decodable: clip.decodable,
      effectiveFps: timebase.ok ? timebase.value.fps : null,
      mode: 'sprint',
      irregularShare: Number.isFinite(timing.irregularShare) ? timing.irregularShare : null,
      widthPx: clip.widthPx,
      heightPx: clip.heightPx,
      durationSec: clip.durationSec,
      calibrationPresent: true,
      athleteSelected: true,
      cameraShiftPx: null,
    },
    config.gate,
  ).filter((c) => (DEVICE_CHECK_IDS as readonly string[]).includes(c.id));
  const failed = checks.some((c) => c.level === 'fail');
  const warned = checks.some((c) => c.level === 'warn') || retimed;
  return {
    result: failed ? 'fail' : warned ? 'conditional' : 'pass',
    checks,
    reasons: [
      ...checks.filter((c) => c.level !== 'pass').map((c) => c.id),
      ...(retimed ? [RETIMED] : []),
    ],
    captureFps: timebase.ok ? timebase.value.fps : null,
    fileFps: Number.isFinite(timing.impliedFps) ? timing.impliedFps : null,
    irregularShare: Number.isFinite(timing.irregularShare) ? timing.irregularShare : null,
    timingJitter: coefficientOfVariation(timing.intervalsSec),
    retimed,
  };
}

export interface PhoneDescription {
  model: string | null;
  os: string | null;
  browser: string | null;
}

/** The phone, operating system and browser, from the user agent string. */
export function describePhone(userAgent: string): PhoneDescription {
  const android = /Android (\d+(?:\.\d+)?)/.exec(userAgent);
  const ios = /(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(userAgent);
  const os = android
    ? `Android ${android[1] ?? ''}`
    : ios
      ? `iOS ${ios[1] ?? ''}.${ios[2] ?? ''}`
      : /Windows NT/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : null;
  // Order matters: Edge and Samsung Internet also say Chrome, and Chrome also says Safari.
  const browsers: [RegExp, string][] = [
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/Edg\w*\/(\d+)/, 'Edge'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari'],
  ];
  let browser: string | null = null;
  for (const [re, name] of browsers) {
    const m = re.exec(userAgent);
    if (m) {
      browser = `${name} ${m[1] ?? ''}`;
      break;
    }
  }
  // Android user agents name the model before the build (reduced agents say only "K").
  const androidModel = /Android [\d.]+; ([^;)]+)/.exec(userAgent)?.[1]?.trim();
  const model = /iPhone/.test(userAgent)
    ? 'iPhone'
    : androidModel && androidModel !== 'K'
      ? androidModel
      : null;
  return { model, os, browser };
}

interface UaData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>;
}

/** The model name the browser reports, where it will (Chrome on Android). */
export async function reportedModel(): Promise<string | null> {
  const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData;
  try {
    const values = await data?.getHighEntropyValues?.(['model']);
    return values?.model?.trim() || null;
  } catch {
    return null;
  }
}
