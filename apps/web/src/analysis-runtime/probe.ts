import type { Outcome } from '@stride/analysis/types';
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';

// Reads a clip's container metadata (codec, size, rotation, every frame timestamp) without
// decoding any video. mp4box parses the moov box; when moov sits after the media data, as it
// does in many phone recordings, mp4box asks for the moov position and the media is skipped.

export interface ClipProbe {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** Display size after the container rotation. */
  widthPx: number;
  heightPx: number;
  rotation: 0 | 90 | 180 | 270;
  frameCount: number;
  durationSec: number;
  /** Presentation timestamps of every frame in display order, seconds, as stored in the file. */
  containerTimesSec: Float64Array;
  timescale: number;
  trackId: number;
  /** Decoder configuration record (avcC, hvcC, vpcC or av1C body), when present. */
  description: Uint8Array | null;
  fileSize: number;
}

export type ProbeError = 'not_mp4' | 'no_video_track' | 'read_failed';

const CHUNK_BYTES = 4 * 1024 * 1024;

/** Rotation in degrees from the track matrix (16.16 fixed point a, b, c, d). */
export function rotationFromMatrix(matrix: ArrayLike<number>): 0 | 90 | 180 | 270 {
  const a = matrix[0] ?? 65536;
  const b = matrix[1] ?? 0;
  const degrees = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  const normalised = ((degrees % 360) + 360) % 360;
  if (normalised === 90 || normalised === 180 || normalised === 270) return normalised;
  return 0;
}

interface ConfigBox {
  write(stream: unknown): void;
}

interface VisualEntry {
  avcC?: ConfigBox;
  hvcC?: ConfigBox;
  vpcC?: ConfigBox;
  av1C?: ConfigBox;
}

/** The decoder description: the codec configuration box without its 8-byte header. */
function decoderDescription(
  mp4: ReturnType<typeof createFile>,
  trackId: number,
): Uint8Array | null {
  const trak = mp4.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries as unknown as VisualEntry[]) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8);
  }
  return null;
}

export async function probeClip(file: Blob): Promise<Outcome<ClipProbe, ProbeError>> {
  const mp4 = createFile();
  let movie: Movie | null = null;
  let failed = false;
  mp4.onReady = (info) => {
    movie = info;
  };
  mp4.onError = () => {
    failed = true;
  };
  try {
    let offset = 0;
    while (movie === null && !failed && offset < file.size) {
      const end = Math.min(file.size, offset + CHUNK_BYTES);
      const buffer = MP4BoxBuffer.fromArrayBuffer(
        await file.slice(offset, end).arrayBuffer(),
        offset,
      );
      const next = mp4.appendBuffer(buffer, end >= file.size);
      offset = next > offset ? next : end;
    }
    mp4.flush();
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
  const info = movie as Movie | null;
  if (failed || info === null) return { ok: false, reason: 'not_mp4' };
  const track = info.videoTracks[0];
  if (!track) return { ok: false, reason: 'no_video_track' };

  const samples: Sample[] = mp4.getTrackById(track.id).samples ?? [];
  const times = samples.map((s) => s.cts / s.timescale).sort((x, y) => x - y);
  const rotation = rotationFromMatrix(track.matrix);
  const codedWidth = track.video?.width ?? track.track_width;
  const codedHeight = track.video?.height ?? track.track_height;
  const swap = rotation === 90 || rotation === 270;
  return {
    ok: true,
    value: {
      codec: track.codec,
      codedWidth,
      codedHeight,
      widthPx: swap ? codedHeight : codedWidth,
      heightPx: swap ? codedWidth : codedHeight,
      rotation,
      frameCount: samples.length,
      durationSec:
        track.timescale > 0 ? track.duration / track.timescale : info.duration / info.timescale,
      containerTimesSec: Float64Array.from(times),
      timescale: track.timescale,
      trackId: track.id,
      description: decoderDescription(mp4, track.id),
      fileSize: file.size,
    },
  };
}
