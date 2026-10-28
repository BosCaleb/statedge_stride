import type { Landmark, Roi } from '@stride/analysis/types';
import manifest from './models.json';

/**
 * All pose estimation sits behind this interface so that MediaPipe can be swapped without
 * touching the metrics. `meta.index` (the decoded frame index) is optional; the recorded-fixture
 * estimator used in end-to-end tests needs it.
 */
export interface PoseEstimator {
  readonly id: string;
  readonly version: string;
  init(signal?: AbortSignal): Promise<void>;
  /** Landmarks in full-frame pixels, or null when no person was found in the crop. */
  estimate(frame: ImageBitmap, roi: Roi, meta?: { index: number }): Promise<Landmark[] | null>;
  dispose(): void;
}

export type ModelVariant = keyof typeof manifest.models;
export type Delegate = 'GPU' | 'CPU';

export const MODEL_VARIANTS = Object.keys(manifest.models) as ModelVariant[];

/** Self-hosted model and WASM locations, with versioned names so updates are explicit. */
export function modelUrl(variant: ModelVariant): string {
  return `${import.meta.env.BASE_URL}models/${manifest.models[variant].file}`;
}

export function wasmBaseUrl(): string {
  return `${import.meta.env.BASE_URL}models/${manifest.wasmDir}`;
}

export const TASKS_VISION_VERSION = manifest.tasksVisionVersion;

/** The module-worker WASM runtime files (see mediapipeEstimator.ts). */
export const WASM_FILES = ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'];

/** Every file "Prepare for offline" downloads into the models-v1 cache. */
export function offlineModelFiles(variant: ModelVariant): string[] {
  return [modelUrl(variant), ...WASM_FILES.map((f) => `${wasmBaseUrl()}/${f}`)];
}
