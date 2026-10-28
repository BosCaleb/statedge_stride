// Size, time and pagination limits shared by the web app and the API.

export const LIMITS = {
  /** JSON request bodies. */
  jsonBodyBytes: 256 * 1024,
  /** Gzip-compressed SKP1 keypoint uploads. */
  keypointsCompressedBytes: 5 * 1024 * 1024,
  /** Decompressed keypoints, checked while streaming to defeat decompression bombs. */
  keypointsDecompressedBytes: 20 * 1024 * 1024,
  /** Key-frame JPEGs. */
  frameJpegBytes: 300 * 1024,
  maxReportFrames: 5,
  pageDefault: 25,
  pageMax: 100,
  inviteExpiryDays: 7,
  shareDefaultDays: 30,
  shareMaxDays: 90,
  /** Random bytes in invite and share tokens (base64url encoded). */
  tokenBytes: 32,
  auditRetentionMonths: 24,
} as const;
