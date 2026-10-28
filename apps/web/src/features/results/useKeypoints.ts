import { decodeSkp1, type DecodedKeypoints } from '@stride/analysis/skp1';
import { useEffect, useState } from 'react';

/** Decompresses and decodes a gzip SKP1 keypoint file. */
export async function decodeKeypoints(blob: Blob): Promise<DecodedKeypoints | null> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const decoded = decodeSkp1(bytes);
  return decoded.ok ? decoded.value : null;
}

export function useKeypoints(blob: Blob | null | undefined): DecodedKeypoints | null {
  const [keypoints, setKeypoints] = useState<DecodedKeypoints | null>(null);
  useEffect(() => {
    if (!blob) {
      setKeypoints(null);
      return;
    }
    let live = true;
    void decodeKeypoints(blob)
      .then((k) => {
        if (live) setKeypoints(k);
      })
      .catch(() => {
        if (live) setKeypoints(null);
      });
    return () => {
      live = false;
    };
  }, [blob]);
  return keypoints;
}
