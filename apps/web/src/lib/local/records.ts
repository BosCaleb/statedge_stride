import { analysisResultSchema } from '@stride/shared/analysisResult';
import { idSchema } from '@stride/shared/api/common';
import { fingerprintSchema } from '@stride/shared/api/sessions';
import { clipRoleSchema } from '@stride/shared/enums';
import { z } from 'zod';
import { jobStatsSchema } from '../../analysis-runtime/messages';
import { indexedDbAvailable, strideDb } from '../idb';

// What the phone keeps for the analysis loop, so that import, calibration, analysis and review
// work with no signal: imported clips, calibrations and finished results. Every record is
// parsed on the way in and out of IndexedDB. Without IndexedDB (some private modes, the unit
// tests) the records live in memory for this visit only.

const finite = z.number().finite();
const point = z.object({ x: finite, y: finite });
const isoDateTime = z.iso.datetime();

export const copyLocationSchema = z.enum(['opfs', 'idb', 'none']);
/** Where the copy of the video is: the app's private files, IndexedDB, or not kept. */
export type CopyLocation = z.infer<typeof copyLocationSchema>;

export const localClipSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  /** Null for a calibration clip. */
  athleteId: idSchema.nullable(),
  role: clipRoleSchema,
  /** The calibration a run clip uses, or the one a calibration clip produced. */
  calibrationId: idSchema.nullable(),
  /** Shown on this phone only; never sent. */
  fileName: z.string().max(260),
  size: z.number().int().nonnegative(),
  fingerprint: fingerprintSchema,
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  frameCount: z.number().int().nonnegative(),
  durationSec: finite.nonnegative(),
  codec: z.string().max(60),
  /** The capture rate the coach chose (Slow motion is 240). */
  declaredFps: z.number().int().positive(),
  /** From the frame timestamps in the file. A re-timed slow-motion file shows its playback rate. */
  detectedFps: finite.positive().nullable(),
  /** Share of frame intervals more than the tolerance away from the median. */
  irregularShare: finite.nonnegative().nullable(),
  copy: copyLocationSchema,
  importedAt: isoDateTime,
});
export type LocalClip = z.infer<typeof localClipSchema>;

export const localCalibrationSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  /** The calibration clip the frame came from. */
  clipId: idSchema,
  distanceM: finite.positive(),
  markerA: point,
  markerB: point,
  pxPerM: finite.positive(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  /** Grayscale thumbnail of the calibration frame, for the camera-stability check. */
  signature: z.instanceof(Float32Array),
  signatureWidth: z.number().int().positive(),
  signatureHeight: z.number().int().positive(),
  /** JPEG of the frame the markers were tapped on. */
  frame: z.instanceof(Blob),
  frameTimeSec: finite.nonnegative(),
  createdAt: isoDateTime,
});
export type LocalCalibration = z.infer<typeof localCalibrationSchema>;

export const roiSchema = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
});

export const localResultSchema = z.object({
  /** Also the analysis id when it is saved. */
  id: idSchema,
  clipId: idSchema,
  sessionId: idSchema,
  athleteId: idSchema,
  calibrationId: idSchema.nullable(),
  roi: roiSchema,
  roiFrame: z.number().int().nonnegative(),
  result: analysisResultSchema,
  /** gzip of the SKP1 keypoint file. */
  keypoints: z.instanceof(Blob),
  stats: jobStatsSchema,
  /** The coach's note, kept here until the result is saved. */
  noteDraft: z.string().max(4000),
  createdAt: isoDateTime,
  /** Set once the save has been queued. */
  savedAt: isoDateTime.nullable(),
});
export type LocalResult = z.infer<typeof localResultSchema>;

export interface RecordStore<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  all(): Promise<T[]>;
  put(record: T): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

function idbRecords<T extends { id: string }>(
  name: 'clips' | 'calibrations' | 'results',
  schema: z.ZodType<T>,
): RecordStore<T> {
  const parse = (raw: unknown): T | undefined => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    async get(id) {
      return parse(await (await strideDb()).get(name, id));
    },
    async all() {
      const rows = await (await strideDb()).getAll(name);
      return rows.map(parse).filter((r): r is T => r !== undefined);
    },
    async put(record) {
      await (await strideDb()).put(name, schema.parse(record), record.id);
    },
    async delete(id) {
      await (await strideDb()).delete(name, id);
    },
    async clear() {
      await (await strideDb()).clear(name);
    },
  };
}

export function memoryRecords<T extends { id: string }>(schema: z.ZodType<T>): RecordStore<T> {
  const rows = new Map<string, T>();
  return {
    get: (id) => Promise.resolve(rows.get(id)),
    all: () => Promise.resolve([...rows.values()]),
    put: (record) =>
      Promise.resolve().then(() => {
        rows.set(record.id, schema.parse(record));
      }),
    delete: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      rows.clear();
      return Promise.resolve();
    },
  };
}

const persistent = indexedDbAvailable();

export const localClips: RecordStore<LocalClip> = persistent
  ? idbRecords('clips', localClipSchema)
  : memoryRecords(localClipSchema);

export const localCalibrations: RecordStore<LocalCalibration> = persistent
  ? idbRecords('calibrations', localCalibrationSchema)
  : memoryRecords(localCalibrationSchema);

export const localResults: RecordStore<LocalResult> = persistent
  ? idbRecords('results', localResultSchema)
  : memoryRecords(localResultSchema);
