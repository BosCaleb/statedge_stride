import '../lib/zodSetup';
import { clipChecks } from '@stride/analysis/gate';
import { analyse, type AnalysisInput } from '@stride/analysis/pipeline';
import { encodeSkp1 } from '@stride/analysis/skp1';
import { phaseCorrelation, shiftInFramePixels, toThumbnail } from '@stride/analysis/stability';
import { median } from '@stride/analysis/stats';
import { chooseTimebase, timingStats } from '@stride/analysis/timebase';
import type { Landmark, PoseFrame, Roi } from '@stride/analysis/types';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { FailCode, Stage } from '@stride/shared/enums';
import {
  webCodecsSource,
  webCodecsSupported,
  type DecodedFrame,
  type FrameSource,
} from './decoder';
import { MediaPipePoseEstimator } from './mediapipeEstimator';
import {
  toWorkerSchema,
  type EstimatorSpec,
  type FromWorker,
  type JobStats,
  type StartMessage,
} from './messages';
import type { PoseEstimator } from './poseEstimator';
import { probeClip, type ClipProbe } from './probe';
import { confidentBox, RoiTracker } from './roi';
import { grayscaleSignature } from './signature';

// The analysis job worker: decode, pose and the pure analysis stages, off the UI thread.

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}
const scope = self as unknown as WorkerScope;

class JobFailure extends Error {
  constructor(
    readonly code: FailCode,
    detail: string,
  ) {
    super(detail);
  }
}

/** Frames posted by the main-thread video-element decoder. */
class ExternalFrames implements FrameSource {
  readonly kind = 'video-element' as const;
  droppedFrames = 0;
  private queue: DecodedFrame[] = [];
  private ended = false;
  private wake: (() => void) | null = null;

  push(frame: DecodedFrame) {
    this.queue.push(frame);
    this.notify();
  }

  end(droppedFrames: number) {
    this.droppedFrames = droppedFrames;
    this.ended = true;
    this.notify();
  }

  private notify() {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async *frames(signal: AbortSignal): AsyncGenerator<DecodedFrame> {
    for (;;) {
      if (signal.aborted) return;
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  dispose() {
    for (const f of this.queue) f.bitmap.close();
    this.queue = [];
  }
}

async function createEstimator(spec: EstimatorSpec, maxCropPx: number): Promise<PoseEstimator> {
  if (spec.kind === 'fixture') {
    // Test builds only: the branch, and the module, are removed from production builds.
    if (import.meta.env.VITE_E2E === 'true') {
      const { FixturePoseEstimator } = await import('./fixtureEstimator');
      return new FixturePoseEstimator(spec.url);
    }
    throw new JobFailure('model_load_failed', 'fixture estimator is not available in this build');
  }
  return new MediaPipePoseEstimator({ variant: spec.variant, delegate: spec.delegate, maxCropPx });
}

class Job {
  readonly controller = new AbortController();
  readonly external: ExternalFrames | null;
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private lastProgress = 0;

  constructor(readonly msg: StartMessage) {
    this.external = msg.decoder === 'external' ? new ExternalFrames() : null;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const w of waiters) w();
  }

  private async whilePaused() {
    while (this.paused && !this.controller.signal.aborted) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  /** Progress messages are throttled to at most ten per second. */
  private progress(stage: Stage, fraction: number, force = false) {
    const now = performance.now();
    if (!force && now - this.lastProgress < 100) return;
    this.lastProgress = now;
    scope.postMessage({
      type: 'progress',
      jobId: this.msg.jobId,
      stage,
      fraction: Math.min(1, Math.max(0, fraction)),
    });
  }

  async run(): Promise<void> {
    const { msg } = this;
    const { config } = msg;
    const signal = this.controller.signal;
    const started = performance.now();
    this.progress('reading', 0, true);

    const probed = await probeClip(msg.file);
    if (!probed.ok) {
      throw new JobFailure(
        probed.reason === 'read_failed' ? 'decode_failed' : 'unsupported_codec',
        probed.reason,
      );
    }
    const probe = probed.value;
    const frameStep = config.metrics.frameStep[msg.mode];
    const timebase = chooseTimebase(probe.containerTimesSec, msg.declaredFps, config);
    const timing = timingStats(probe.containerTimesSec, config.gate.timing.intervalTolerance);
    const decodable = msg.decoder === 'external' || (await webCodecsSupported(probe));
    const captureFps = timebase.ok ? timebase.value.fps : msg.declaredFps;
    const timesSec = timebase.ok
      ? timebase.value.timesSec
      : Float64Array.from(probe.containerTimesSec, (_t, i) => i / msg.declaredFps);

    const checksWith = (cameraShiftPx: number | null) =>
      clipChecks(
        {
          decodable,
          effectiveFps: timebase.ok ? timebase.value.fps / frameStep : null,
          mode: msg.mode,
          irregularShare: timing.irregularShare,
          widthPx: probe.widthPx,
          heightPx: probe.heightPx,
          durationSec: probe.durationSec,
          calibrationPresent: msg.calibration !== null,
          athleteSelected: true,
          cameraShiftPx,
        },
        config.gate,
      );

    const input = (
      frames: PoseFrame[],
      checks: AnalysisInput['clipChecks'],
      poseModel: AnalysisInput['poseModel'],
    ): AnalysisInput => ({
      frames,
      clip: {
        widthPx: probe.widthPx,
        heightPx: probe.heightPx,
        frameCount: probe.frameCount,
        declaredFps: msg.declaredFps,
        codec: probe.codec,
        durationSec: probe.durationSec,
      },
      timesSec,
      timebase: timebase.ok ? timebase.value.source : 'declared',
      captureFps,
      frameStep,
      mode: msg.mode,
      calibration: msg.calibration
        ? {
            markerA: msg.calibration.markerA,
            markerB: msg.calibration.markerB,
            distanceM: msg.calibration.distanceM,
            pxPerM: msg.calibration.pxPerM,
          }
        : null,
      clipChecks: checks,
      poseModel,
      config,
      createdAt: msg.createdAt,
    });

    const stats: JobStats = {
      decoder: msg.decoder === 'external' ? 'video-element' : 'webcodecs',
      delegate: 'none',
      framesAnalysed: 0,
      framesWithPose: 0,
      poseMsMedian: 0,
      poseMsTotal: 0,
      wallMs: 0,
      droppedFrames: 0,
      stoppedAt: null,
    };

    // Clip-level checks first, so that a hopeless clip fails before any pose estimation.
    let checks = checksWith(null);
    if (checks.some((c) => c.level === 'fail')) {
      this.external?.dispose();
      return this.finish(
        analyse(input([], checks, { id: 'none', version: '0' })).result,
        [],
        probe,
        stats,
        started,
      );
    }

    const estimator = await createEstimator(msg.estimator, config.roi.maxCropDrawPx);
    try {
      await estimator.init(signal);
    } catch (error) {
      estimator.dispose();
      this.external?.dispose();
      if (signal.aborted) throw new JobFailure('cancelled', 'cancelled');
      throw new JobFailure(
        'model_load_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (estimator instanceof MediaPipePoseEstimator)
      stats.delegate = estimator.delegateInUse ?? 'none';
    const poseModel = { id: estimator.id, version: estimator.version };

    const source =
      this.external ?? webCodecsSource(msg.file, probe, { startFrame: msg.roiFrame, frameStep });
    const tracker = new RoiTracker(msg.roi, probe.widthPx, probe.heightPx, config);
    const frames: PoseFrame[] = [];
    const poseMs: number[] = [];
    const sigW = config.calibration.signatureWidth;
    const sigH = config.calibration.signatureHeight;
    const toSig = (box: Roi) => toThumbnail(box, probe.widthPx, probe.heightPx, sigW, sigH);
    let first: { signature: Float32Array; box: Roi } | null = null;
    let last: { signature: Float32Array; box: Roi } | null = null;
    let calibrationShift: number | null = null;
    const span = Math.max(1, probe.frameCount - msg.roiFrame);

    try {
      for await (const frame of source.frames(signal)) {
        try {
          await this.whilePaused();
          if (signal.aborted) break;
          if (!first) {
            first = {
              signature: grayscaleSignature(
                frame.bitmap,
                probe.widthPx,
                probe.heightPx,
                sigW,
                sigH,
              ),
              box: msg.roi,
            };
            const cal = msg.calibration;
            if (cal) {
              const sameSize =
                cal.frameWidth === probe.widthPx && cal.frameHeight === probe.heightPx;
              calibrationShift = sameSize
                ? shiftInFramePixels(
                    phaseCorrelation(cal.backgroundSignature, first.signature, sigW, sigH, [
                      toSig(msg.roi),
                    ]),
                    sigW,
                    probe.widthPx,
                  )
                : Infinity;
              checks = checksWith(calibrationShift);
              if (checks.some((c) => c.level === 'fail')) break;
            }
          }
          const started = performance.now();
          let landmarks: Landmark[] | null = await estimator.estimate(
            frame.bitmap,
            tracker.crop(),
            { index: frame.index },
          );
          if (!landmarks)
            landmarks = await estimator.estimate(frame.bitmap, tracker.retryCrop(), {
              index: frame.index,
            });
          poseMs.push(performance.now() - started);
          const step = tracker.update(frame.index, landmarks);
          frames.push({
            index: frame.index,
            tSec: timesSec[frame.index] ?? frame.timeSec,
            landmarks,
          });
          if (frames.length % 24 === 0) {
            const box =
              (landmarks && confidentBox(landmarks, config.landmarks.confidentVisibility)) ??
              tracker.crop();
            last = {
              signature: grayscaleSignature(
                frame.bitmap,
                probe.widthPx,
                probe.heightPx,
                sigW,
                sigH,
              ),
              box,
            };
          }
          if (step.kind === 'exited') {
            stats.stoppedAt = frame.index;
            break;
          }
          if (step.kind === 'lost')
            throw new JobFailure('tracking_lost', `frames ${step.fromFrame}-${step.toFrame}`);
          if (step.kind === 'never_found')
            throw new JobFailure('no_person', `no person found by frame ${frame.index}`);
          this.progress('finding', (frame.index - msg.roiFrame) / span);
        } finally {
          frame.bitmap.close();
          if (this.external)
            scope.postMessage({ type: 'consumed', jobId: msg.jobId, index: frame.index });
        }
      }
    } finally {
      estimator.dispose();
      this.external?.dispose();
    }
    if (signal.aborted) throw new JobFailure('cancelled', 'cancelled');

    stats.framesAnalysed = frames.length;
    stats.framesWithPose = frames.filter((f) => f.landmarks !== null).length;
    stats.poseMsMedian = median(poseMs) || 0;
    stats.poseMsTotal = poseMs.reduce((a, b) => a + b, 0);
    stats.droppedFrames = source.droppedFrames;

    // The camera check combines the calibration comparison with first versus last frame.
    let shift = calibrationShift;
    if (first && last) {
      const within = shiftInFramePixels(
        phaseCorrelation(first.signature, last.signature, sigW, sigH, [
          toSig(first.box),
          toSig(last.box),
        ]),
        sigW,
        probe.widthPx,
      );
      shift = Math.max(shift ?? 0, within);
    }
    checks = checksWith(shift);
    this.progress('detecting', 0.5, true);
    const output = analyse(input(frames, checks, poseModel));
    this.progress('calculating', 1, true);
    return this.finish(output.result, frames, probe, stats, started);
  }

  private finish(
    result: AnalysisResult,
    frames: PoseFrame[],
    probe: ClipProbe,
    stats: JobStats,
    started: number,
  ) {
    const byIndex: (Landmark[] | null)[] = new Array<Landmark[] | null>(probe.frameCount).fill(
      null,
    );
    for (const f of frames) if (f.index < byIndex.length) byIndex[f.index] = f.landmarks;
    const keypoints = encodeSkp1({
      widthPx: probe.widthPx,
      heightPx: probe.heightPx,
      mirrored: result.direction === -1,
      timesSec: probe.containerTimesSec,
      frames: byIndex,
    });
    const buffer = keypoints.buffer as ArrayBuffer;
    scope.postMessage(
      {
        type: 'done',
        jobId: this.msg.jobId,
        result,
        keypoints: buffer,
        stats: { ...stats, wallMs: performance.now() - started },
      },
      [buffer],
    );
  }
}

let current: Job | null = null;

function failureCode(error: unknown): { code: FailCode; detail: string } {
  if (error instanceof JobFailure) return { code: error.code, detail: error.message };
  if (error instanceof DOMException && error.name === 'AbortError')
    return { code: 'cancelled', detail: 'cancelled' };
  if (
    error instanceof RangeError ||
    (error instanceof DOMException && error.name === 'QuotaExceededError')
  ) {
    return { code: 'out_of_memory', detail: error.message };
  }
  if (
    error instanceof DOMException &&
    (error.name === 'EncodingError' || error.name === 'NotSupportedError')
  ) {
    return { code: 'decode_failed', detail: error.message };
  }
  return { code: 'unknown', detail: error instanceof Error ? error.message : String(error) };
}

scope.addEventListener('message', (event) => {
  const parsed = toWorkerSchema.safeParse(event.data);
  if (!parsed.success) return;
  const msg = parsed.data;
  switch (msg.type) {
    case 'start': {
      current?.controller.abort();
      const job = new Job(msg);
      current = job;
      job
        .run()
        .catch((error: unknown) => {
          const { code, detail } = failureCode(error);
          scope.postMessage({ type: 'failed', jobId: msg.jobId, code, detail });
        })
        .finally(() => {
          if (current === job) current = null;
        });
      break;
    }
    case 'cancel':
      if (current?.msg.jobId === msg.jobId) current.controller.abort();
      break;
    case 'pause':
      if (current?.msg.jobId === msg.jobId) current.pause();
      break;
    case 'resume':
      if (current?.msg.jobId === msg.jobId) current.resume();
      break;
    case 'frame':
      if (current?.msg.jobId === msg.jobId && current.external) {
        current.external.push({ index: msg.index, timeSec: msg.timeSec, bitmap: msg.bitmap });
      } else {
        msg.bitmap.close();
      }
      break;
    case 'end-of-frames':
      if (current?.msg.jobId === msg.jobId) current.external?.end(msg.droppedFrames);
      break;
  }
});
