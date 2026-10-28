// The browser features the analysis loop relies on, checked on first launch. Missing WebCodecs
// is not fatal (the video-element decoder takes over); anything else gets a clear message.

export const CAPABILITIES = [
  'workers',
  'webCodecs',
  'gpu',
  'opfs',
  'compression',
  'wakeLock',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

function hasWebGl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function detectCapabilities(
  w: Window & typeof globalThis = window,
): Record<Capability, boolean> {
  const nav = w.navigator as Navigator & { gpu?: unknown };
  return {
    workers: typeof w.Worker === 'function',
    webCodecs: typeof (w as { VideoDecoder?: unknown }).VideoDecoder === 'function',
    gpu: nav.gpu !== undefined || hasWebGl2(),
    opfs: typeof nav.storage?.getDirectory === 'function',
    compression:
      typeof w.CompressionStream === 'function' && typeof w.DecompressionStream === 'function',
    wakeLock: 'wakeLock' in nav,
  };
}

/** Missing features, with WebCodecs and the wake lock reported but not blocking. */
export function missingCapabilities(found: Record<Capability, boolean>): {
  blocking: Capability[];
  degraded: Capability[];
} {
  const missing = CAPABILITIES.filter((c) => !found[c]);
  return {
    blocking: missing.filter((c) => c !== 'webCodecs' && c !== 'wakeLock'),
    degraded: missing.filter((c) => c === 'webCodecs' || c === 'wakeLock'),
  };
}
