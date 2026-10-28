// Recognises the same video file again (after the copy is gone, or on another visit) without
// reading all of it: SHA-256 of the first megabyte followed by the file size as an unsigned
// 64-bit big-endian integer, in lower-case hex.

export const FINGERPRINT_HEAD_BYTES = 1024 * 1024;

export async function fingerprint(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, FINGERPRINT_HEAD_BYTES).arrayBuffer());
  const data = new Uint8Array(head.byteLength + 8);
  data.set(head);
  new DataView(data.buffer).setBigUint64(head.byteLength, BigInt(file.size), false);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
