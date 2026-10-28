import type { Landmark, Roi } from '@stride/analysis/types';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  modelUrl,
  TASKS_VISION_VERSION,
  wasmBaseUrl,
  type Delegate,
  type ModelVariant,
  type PoseEstimator,
} from './poseEstimator';
import { fromCrop } from './roi';

export interface MediaPipeOptions {
  variant: ModelVariant;
  delegate: Delegate;
  /** Crops are drawn at most this size before inference (config.roi.maxCropDrawPx). */
  maxCropPx: number;
}

/**
 * MediaPipe Pose Landmarker in image mode. Image mode is used because the crop moves from frame
 * to frame, which breaks the temporal tracker of video mode. The ES-module WASM build is loaded
 * so that the analysis worker can be a module worker (spike item: see docs/spike-report.md).
 */
export class MediaPipePoseEstimator implements PoseEstimator {
  readonly id: string;
  readonly version: string;
  /** The delegate actually in use: GPU falls back to CPU when WebGL is not available. */
  delegateInUse: Delegate | null = null;
  private landmarker: PoseLandmarker | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(private readonly options: MediaPipeOptions) {
    this.id = `mediapipe-pose-${options.variant}`;
    this.version = `${TASKS_VISION_VERSION}+f16-v1`;
  }

  async init(signal?: AbortSignal): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl(), true);
    signal?.throwIfAborted();
    const create = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl(this.options.variant), delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
        ...(delegate === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      });
    try {
      this.landmarker = await create(this.options.delegate);
      this.delegateInUse = this.options.delegate;
    } catch (error) {
      if (this.options.delegate !== 'GPU') throw error;
      this.landmarker = await create('CPU');
      this.delegateInUse = 'CPU';
    }
    signal?.throwIfAborted();
    this.canvas = new OffscreenCanvas(this.options.maxCropPx, this.options.maxCropPx);
    this.ctx = this.canvas.getContext('2d');
  }

  estimate(frame: ImageBitmap, roi: Roi): Promise<Landmark[] | null> {
    const landmarker = this.landmarker;
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!landmarker || !canvas || !ctx)
      return Promise.reject(new Error('estimator not initialised'));
    const size = Math.max(64, Math.min(this.options.maxCropPx, Math.round(roi.width)));
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    ctx.drawImage(frame, roi.x, roi.y, roi.width, roi.height, 0, 0, size, size);
    const result = landmarker.detect(canvas);
    const pose = result.landmarks[0];
    if (!pose || pose.length < 33) return Promise.resolve(null);
    return Promise.resolve(fromCrop(pose, roi));
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.canvas = null;
    this.ctx = null;
  }
}
