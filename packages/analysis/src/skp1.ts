import { LANDMARK_COUNT, type Landmark, type Outcome } from './types';

// SKP1: the raw, uncleaned landmarks of one clip, so that results can be recomputed with a newer
// algorithm without the video. Little-endian throughout. The file is gzip-compressed outside
// this module (CompressionStream in the browser, zlib in Node).
//
// Offset 0  4 bytes ASCII "SKP1"
//        4  uint16 format version (1)
//        6  uint32 frame count
//       10  uint8  landmark count (33)
//       11  uint16 frame width in pixels
//       13  uint16 frame height in pixels
//       15  uint8  flags, bit 0 set when the analysis mirrored the x axis
//       16  float32 container timestamp in seconds, per frame
//   then    per frame, per landmark: x uint16 (x / width * 65535), y uint16, visibility uint8 (* 255)
// A missing landmark has visibility 0 and x and y equal to 65535.

export const SKP1_MAGIC = 'SKP1';
export const SKP1_VERSION = 1;
export const SKP1_HEADER_BYTES = 16;
const BYTES_PER_LANDMARK = 5;
const MISSING = 65535;

export interface KeypointFile {
  widthPx: number;
  heightPx: number;
  mirrored: boolean;
  /** Container timestamps in seconds, one per frame. */
  timesSec: ArrayLike<number>;
  /** One entry per frame: 33 landmarks in full-frame pixels, or null when no person was found. */
  frames: readonly (readonly Landmark[] | null)[];
}

export interface Skp1Header {
  version: number;
  frameCount: number;
  landmarkCount: number;
  widthPx: number;
  heightPx: number;
  mirrored: boolean;
  /** Byte length the file must have, given the header. */
  expectedBytes: number;
}

export type Skp1Error =
  | 'too_short'
  | 'bad_magic'
  | 'unsupported_version'
  | 'bad_landmark_count'
  | 'bad_dimensions'
  | 'size_mismatch';

export function skp1ByteLength(frameCount: number, landmarkCount = LANDMARK_COUNT): number {
  return SKP1_HEADER_BYTES + 4 * frameCount + BYTES_PER_LANDMARK * landmarkCount * frameCount;
}

function quantise(value: number, scale: number): number {
  if (!Number.isFinite(value)) return MISSING;
  // 65535 is reserved for "missing", so valid coordinates use 0 to 65534.
  return Math.min(MISSING - 1, Math.max(0, Math.round((value / scale) * 65535)));
}

export function encodeSkp1(file: KeypointFile): Uint8Array {
  const n = file.frames.length;
  if (file.timesSec.length !== n)
    throw new Error('encodeSkp1: one timestamp per frame is required');
  const bytes = new Uint8Array(skp1ByteLength(n));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, SKP1_MAGIC.charCodeAt(i));
  view.setUint16(4, SKP1_VERSION, true);
  view.setUint32(6, n, true);
  view.setUint8(10, LANDMARK_COUNT);
  view.setUint16(11, file.widthPx, true);
  view.setUint16(13, file.heightPx, true);
  view.setUint8(15, file.mirrored ? 1 : 0);
  let offset = SKP1_HEADER_BYTES;
  for (let f = 0; f < n; f++) {
    view.setFloat32(offset, file.timesSec[f] ?? NaN, true);
    offset += 4;
  }
  for (const landmarks of file.frames) {
    for (let l = 0; l < LANDMARK_COUNT; l++) {
      const lm = landmarks?.[l];
      const missing = !lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y) || !(lm.v > 0);
      view.setUint16(offset, missing ? MISSING : quantise(lm.x, file.widthPx), true);
      view.setUint16(offset + 2, missing ? MISSING : quantise(lm.y, file.heightPx), true);
      view.setUint8(offset + 4, missing ? 0 : Math.max(1, Math.min(255, Math.round(lm.v * 255))));
      offset += BYTES_PER_LANDMARK;
    }
  }
  return bytes;
}

/** Validates the header and the total size without decoding the frames (used by the API). */
export function readSkp1Header(bytes: Uint8Array): Outcome<Skp1Header, Skp1Error> {
  if (bytes.byteLength < SKP1_HEADER_BYTES) return { ok: false, reason: 'too_short' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let magic = '';
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== SKP1_MAGIC) return { ok: false, reason: 'bad_magic' };
  const version = view.getUint16(4, true);
  if (version !== SKP1_VERSION) return { ok: false, reason: 'unsupported_version' };
  const frameCount = view.getUint32(6, true);
  const landmarkCount = view.getUint8(10);
  if (landmarkCount !== LANDMARK_COUNT) return { ok: false, reason: 'bad_landmark_count' };
  const widthPx = view.getUint16(11, true);
  const heightPx = view.getUint16(13, true);
  if (widthPx === 0 || heightPx === 0) return { ok: false, reason: 'bad_dimensions' };
  const expectedBytes = skp1ByteLength(frameCount, landmarkCount);
  if (bytes.byteLength !== expectedBytes) return { ok: false, reason: 'size_mismatch' };
  const mirrored = (view.getUint8(15) & 1) === 1;
  return {
    ok: true,
    value: { version, frameCount, landmarkCount, widthPx, heightPx, mirrored, expectedBytes },
  };
}

export interface DecodedKeypoints {
  header: Skp1Header;
  timesSec: Float64Array;
  frames: (Landmark[] | null)[];
}

export function decodeSkp1(bytes: Uint8Array): Outcome<DecodedKeypoints, Skp1Error> {
  const parsed = readSkp1Header(bytes);
  if (!parsed.ok) return parsed;
  const header = parsed.value;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = header.frameCount;
  const timesSec = new Float64Array(n);
  let offset = SKP1_HEADER_BYTES;
  for (let f = 0; f < n; f++) {
    timesSec[f] = view.getFloat32(offset, true);
    offset += 4;
  }
  const frames: (Landmark[] | null)[] = [];
  for (let f = 0; f < n; f++) {
    const landmarks: Landmark[] = [];
    let anyPresent = false;
    for (let l = 0; l < LANDMARK_COUNT; l++) {
      const qx = view.getUint16(offset, true);
      const qy = view.getUint16(offset + 2, true);
      const qv = view.getUint8(offset + 4);
      offset += BYTES_PER_LANDMARK;
      if (qv === 0 || qx === MISSING || qy === MISSING) {
        landmarks.push({ x: NaN, y: NaN, v: 0 });
      } else {
        anyPresent = true;
        landmarks.push({
          x: (qx / 65535) * header.widthPx,
          y: (qy / 65535) * header.heightPx,
          v: qv / 255,
        });
      }
    }
    frames.push(anyPresent ? landmarks : null);
  }
  return { ok: true, value: { header, timesSec, frames } };
}
