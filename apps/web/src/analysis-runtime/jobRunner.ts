import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { FailCode, Mode, Stage } from '@stride/shared/enums';
import type { Roi } from '@stride/analysis/types';
import { webCodecsSupported } from './decoder';
import { videoElementSource } from './fallbackDecoder';
import {
  fromWorkerSchema,
  type CalibrationInput,
  type EstimatorSpec,
  type JobStats,
  type ToWorker,
} from './messages';
import { probeClip } from './probe';

// Main-thread orchestration of one analysis job: choose the decoder, start the worker, keep
// the screen awake, pause while the page is hidden, and settle with the result or a failure.

export interface JobInput {
  file: Blob;
  calibration: CalibrationInput | null;
  roi: Roi;
  roiFrame: number;
  mode: Mode;
  declaredFps: number;
  config: AnalysisConfig;
  estimator: EstimatorSpec;
}

export type JobOutcome =
  | { kind: 'done'; result: AnalysisResult; keypoints: Uint8Array<ArrayBuffer>; stats: JobStats }
  | { kind: 'failed'; code: FailCode; detail: string };

export interface JobCallbacks {
  onProgress?: (stage: Stage, fraction: number) => void;
  /** Called with true when the page was hidden and the job paused, false when it resumed. */
  onPausedChange?: (paused: boolean) => void;
}

export interface JobHandle {
  readonly jobId: string;
  readonly outcome: Promise<JobOutcome>;
  cancel(): void;
}

/** Frames posted to the worker but not yet consumed, for the video-element decoder. */
const MAX_FRAMES_IN_FLIGHT = 4;

export function startAnalysisJob(input: JobInput, callbacks: JobCallbacks = {}): JobHandle {
  const jobId = crypto.randomUUID();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'stride-analysis',
  });
  const feeding = new AbortController();
  let wakeLock: WakeLockSentinel | null = null;
  let settle: (outcome: JobOutcome) => void = () => undefined;
  let consumed = -1;
  let posted = 0;
  let wakeFeeder: (() => void) | null = null;

  const post = (message: ToWorker, transfer: Transferable[] = []) =>
    worker.postMessage(message, transfer);

  const requestWakeLock = async () => {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock = null; // Not available or refused; the job still runs.
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      post({ type: 'pause', jobId });
      callbacks.onPausedChange?.(true);
    } else {
      post({ type: 'resume', jobId });
      callbacks.onPausedChange?.(false);
      void requestWakeLock();
    }
  };

  const outcome = new Promise<JobOutcome>((resolve) => {
    let done = false;
    settle = (o) => {
      if (done) return;
      done = true;
      feeding.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      void wakeLock?.release().catch(() => undefined);
      worker.terminate();
      resolve(o);
    };
  });

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const parsed = fromWorkerSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.jobId !== jobId) return;
    const msg = parsed.data;
    switch (msg.type) {
      case 'progress':
        callbacks.onProgress?.(msg.stage, msg.fraction);
        break;
      case 'consumed':
        consumed++;
        wakeFeeder?.();
        break;
      case 'done':
        settle({
          kind: 'done',
          result: msg.result,
          keypoints: new Uint8Array(msg.keypoints),
          stats: msg.stats,
        });
        break;
      case 'failed':
        settle({ kind: 'failed', code: msg.code, detail: msg.detail });
        break;
    }
  });
  worker.addEventListener('error', (event) => {
    settle({ kind: 'failed', code: 'unknown', detail: event.message || 'worker error' });
  });

  const begin = async () => {
    document.addEventListener('visibilitychange', onVisibility);
    await requestWakeLock();
    const probed = await probeClip(input.file);
    const decoder =
      probed.ok && (await webCodecsSupported(probed.value)) ? 'webcodecs' : 'external';
    post({
      type: 'start',
      jobId,
      file: input.file,
      calibration: input.calibration,
      roi: input.roi,
      roiFrame: input.roiFrame,
      mode: input.mode,
      declaredFps: input.declaredFps,
      config: input.config,
      decoder,
      estimator: input.estimator,
      createdAt: new Date().toISOString(),
    });
    if (decoder !== 'external' || !probed.ok) return;
    const source = videoElementSource(input.file, probed.value, {
      startFrame: input.roiFrame,
      frameStep: input.config.metrics.frameStep[input.mode],
    });
    for await (const frame of source.frames(feeding.signal)) {
      while (posted - (consumed + 1) >= MAX_FRAMES_IN_FLIGHT && !feeding.signal.aborted) {
        await new Promise<void>((resolve) => {
          wakeFeeder = resolve;
        });
      }
      post(
        { type: 'frame', jobId, index: frame.index, timeSec: frame.timeSec, bitmap: frame.bitmap },
        [frame.bitmap],
      );
      posted++;
    }
    if (!feeding.signal.aborted)
      post({ type: 'end-of-frames', jobId, droppedFrames: source.droppedFrames });
  };
  begin().catch((error: unknown) => {
    settle({
      kind: 'failed',
      code: 'decode_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    jobId,
    outcome,
    cancel() {
      post({ type: 'cancel', jobId });
      feeding.abort();
      wakeFeeder?.();
      // The worker replies with a cancelled failure; terminate anyway if it does not.
      setTimeout(() => settle({ kind: 'failed', code: 'cancelled', detail: 'cancelled' }), 2000);
    },
  };
}
