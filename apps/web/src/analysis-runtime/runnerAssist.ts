import { defaultConfig } from '@stride/analysis/config';
import {
  chooseRunner,
  sampleFrames,
  type FrameDetections,
  type RunnerChoice,
} from '@stride/analysis/runner';
import { fromAssistSchema, type FromAssist, type ToAssist } from './assistMessages';
import { FrameGrabber, type FrameSize } from './frameGrab';

// The page side of the assist worker: grabs frames of the clip with the video element and hands
// them to a short-lived worker, to find the runner for the athlete box suggestion, or to time the
// heavy pose model for the device check.

/** Frames for the detector are scaled to this width: people stay large enough to find. */
const DETECT_WIDTH = 640;

function ask(
  message: ToAssist,
  transfer: Transferable[],
  signal?: AbortSignal,
): Promise<FromAssist> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./assistWorker.ts', import.meta.url), { type: 'module' });
    const done = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      done();
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      done();
      const parsed = fromAssistSchema.safeParse(event.data);
      if (parsed.success) resolve(parsed.data);
      else reject(new Error('unexpected reply from the assist worker'));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || 'assist worker failed'));
    };
    worker.postMessage(message, transfer);
  });
}

async function grabFrames(
  file: Blob,
  times: Float64Array,
  frames: number[],
  size: FrameSize,
  fps: number,
  signal?: AbortSignal,
): Promise<{ frame: number; bitmap: ImageBitmap }[]> {
  const grabber = new FrameGrabber(file);
  const first = times[0] ?? 0;
  const quarter = 0.25 / Math.max(1, fps);
  try {
    const grabbed: { frame: number; bitmap: ImageBitmap }[] = [];
    for (const frame of frames) {
      signal?.throwIfAborted();
      const t = (times[frame] ?? first) - first + quarter;
      grabbed.push({ frame, bitmap: await grabber.grab(t, size) });
    }
    return grabbed;
  } finally {
    grabber.dispose();
  }
}

/** The people the detector finds in frames sampled across the clip, in full-frame pixels. */
export async function detectPeople(
  file: Blob,
  times: Float64Array,
  frame: FrameSize,
  fps: number,
  signal?: AbortSignal,
): Promise<FrameDetections[]> {
  const cfg = defaultConfig.runnerDetection;
  const scale = Math.max(1, frame.width / DETECT_WIDTH);
  const small = {
    width: Math.round(frame.width / scale),
    height: Math.round(frame.height / scale),
  };
  const frames = await grabFrames(
    file,
    times,
    sampleFrames(times.length, cfg.samples),
    small,
    fps,
    signal,
  );
  const reply = await ask(
    { type: 'detect', frames, scale, minScore: cfg.minScore },
    frames.map((f) => f.bitmap),
    signal,
  );
  if (reply.type !== 'detected')
    throw new Error(reply.type === 'failed' ? reply.detail : 'no detections');
  return reply.samples;
}

/**
 * Looks for the runner in frames sampled across the clip and returns the suggested athlete box
 * and the frame to start from, or null when nobody suitable was found.
 */
export async function findRunner(
  file: Blob,
  times: Float64Array,
  frame: FrameSize,
  fps: number,
  signal?: AbortSignal,
): Promise<RunnerChoice | null> {
  const samples = await detectPeople(file, times, frame, fps, signal);
  return chooseRunner(samples, frame, defaultConfig.runnerDetection);
}

/** Times the heavy pose model on frames from the middle of the clip, in ms per frame. */
export async function timeHeavyModel(
  file: Blob,
  times: Float64Array,
  frame: FrameSize,
  fps: number,
  signal?: AbortSignal,
): Promise<{ msPerFrame: number; delegate: 'GPU' | 'CPU' }> {
  const n = Math.min(defaultConfig.poseModel.benchmarkFrames, times.length);
  const start = Math.max(0, Math.floor(times.length / 2 - n / 2));
  const frames = Array.from({ length: n }, (_, i) => start + i);
  const grabbed = await grabFrames(file, times, frames, frame, fps, signal);
  const bitmaps = grabbed.map((g) => g.bitmap);
  const reply = await ask(
    { type: 'timePose', variant: 'heavy', bitmaps, maxCropPx: defaultConfig.roi.maxCropDrawPx },
    bitmaps,
    signal,
  );
  if (reply.type !== 'timed') throw new Error(reply.type === 'failed' ? reply.detail : 'not timed');
  return { msPerFrame: reply.msPerFrame, delegate: reply.delegate };
}
