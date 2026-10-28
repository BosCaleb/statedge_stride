// Choices on the import screen that are worth testing on their own.

/** Capture rates offered for "Filmed at". Slow motion on most phones is 240. */
export const FPS_CHOICES = [240, 120, 60, 30] as const;

/**
 * The capture rate to offer first: the file's own rate when it is a slow-motion rate, else 240
 * (a re-timed slow-motion file plays at 30 but was filmed at 240).
 */
export function suggestedFps(fileFps: number | null): number {
  if (fileFps === null || fileFps < 100) return 240;
  return FPS_CHOICES.reduce((best, f) =>
    Math.abs(f - fileFps) < Math.abs(best - fileFps) ? f : best,
  );
}
