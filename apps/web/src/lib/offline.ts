import { offlineModelFiles } from '../analysis-runtime/poseEstimator';

// "Prepare for offline": downloads the pose model and its WASM runtime into the models-v1 cache,
// the same cache the service worker's CacheFirst route reads, so analysis works with no signal.

export const MODELS_CACHE = 'models-v1';

export async function isReadyOffline(
  files: string[] = offlineModelFiles('full'),
): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(MODELS_CACHE);
  const hits = await Promise.all(files.map((f) => cache.match(f)));
  return hits.every((h) => h !== undefined);
}

export async function prepareOffline(
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  files: string[] = offlineModelFiles('full'),
): Promise<void> {
  const cache = await caches.open(MODELS_CACHE);
  const missing: string[] = [];
  for (const f of files) if (!(await cache.match(f))) missing.push(f);
  const responses = await Promise.all(
    missing.map(async (f) => {
      const response = await fetch(f, signal ? { signal } : {});
      if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);
      return { file: f, response };
    }),
  );
  const total = responses.reduce(
    (sum, r) => sum + Number(r.response.headers.get('content-length') ?? 0),
    0,
  );
  let received = 0;
  await Promise.all(
    responses.map(async ({ file, response }) => {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        received += value.byteLength;
        if (total > 0) onProgress(Math.min(1, received / total));
      }
      const headers = new Headers({
        'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
      });
      await cache.put(file, new Response(new Blob(chunks), { headers }));
    }),
  );
  onProgress(1);
}
