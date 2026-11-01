import '../lib/zodSetup';
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { fromAssistSchema, toAssistSchema, type FromAssist, type ToAssist } from './assistMessages';
import { MediaPipePoseEstimator } from './mediapipeEstimator';
import { detectorUrl, wasmBaseUrl } from './poseEstimator';

// The assist worker: one request per worker, then the page terminates it. It runs MediaPipe's
// object detector on sampled frames (people only), or times a pose model on frames of the
// coach's clip. Off the main thread, so the screen stays responsive.

interface WorkerScope {
  postMessage(message: FromAssist): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}
const scope = self as unknown as WorkerScope;

function reply(message: FromAssist): void {
  scope.postMessage(fromAssistSchema.parse(message));
}

/**
 * The detector runs on the CPU: its model is small and it sees only a dozen frames, and the GPU
 * delegate can return no detections at all where WebGL is emulated.
 */
async function createDetector(minScore: number): Promise<ObjectDetector> {
  const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl(), true);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: detectorUrl(), delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: minScore,
    categoryAllowlist: ['person'],
    maxResults: 6,
  });
}

async function detect(msg: Extract<ToAssist, { type: 'detect' }>): Promise<void> {
  const detector = await createDetector(msg.minScore);
  try {
    const samples = msg.frames.map(({ frame, bitmap }) => {
      const result = detector.detect(bitmap);
      bitmap.close();
      return {
        frame,
        boxes: result.detections.flatMap((d) => {
          const b = d.boundingBox;
          const score = d.categories[0]?.score ?? 0;
          if (!b) return [];
          return [
            {
              x: b.originX * msg.scale,
              y: b.originY * msg.scale,
              width: b.width * msg.scale,
              height: b.height * msg.scale,
              score,
            },
          ];
        }),
      };
    });
    reply({ type: 'detected', samples });
  } finally {
    detector.close();
  }
}

async function timePose(msg: Extract<ToAssist, { type: 'timePose' }>): Promise<void> {
  const estimator = new MediaPipePoseEstimator({
    variant: msg.variant,
    delegate: 'GPU',
    maxCropPx: msg.maxCropPx,
  });
  await estimator.init();
  try {
    const [first, ...rest] = msg.bitmaps;
    if (!first) throw new Error('no frames');
    const square = (b: ImageBitmap) => {
      const side = Math.min(b.width, b.height);
      return { x: (b.width - side) / 2, y: (b.height - side) / 2, width: side, height: side };
    };
    // The first inference sets up the GPU pipeline; it is not timed.
    await estimator.estimate(first, square(first));
    const started = performance.now();
    for (const b of rest) await estimator.estimate(b, square(b));
    const msPerFrame = (performance.now() - started) / rest.length;
    reply({ type: 'timed', msPerFrame, delegate: estimator.delegateInUse ?? 'CPU' });
  } finally {
    for (const b of msg.bitmaps) b.close();
    estimator.dispose();
  }
}

scope.addEventListener('message', (event) => {
  const parsed = toAssistSchema.safeParse(event.data);
  if (!parsed.success) {
    reply({ type: 'failed', detail: 'invalid message' });
    return;
  }
  const msg = parsed.data;
  const work = msg.type === 'detect' ? detect(msg) : timePose(msg);
  work.catch((error: unknown) =>
    reply({ type: 'failed', detail: error instanceof Error ? error.message : String(error) }),
  );
});
