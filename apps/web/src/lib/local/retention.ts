import { deleteCopy } from './clipLibrary';
import type { LocalClip, RecordStore } from './records';

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the copy of this clip has been on the phone longer than the retention period. */
export function copyExpired(clip: LocalClip, retentionDays: number, now: Date): boolean {
  return (
    clip.copy !== 'none' && now.getTime() - Date.parse(clip.importedAt) > retentionDays * DAY_MS
  );
}

/**
 * Removes the copies of clips older than the organisation's retention period. Runs on app
 * start. The clip record stays, so that its results can still offer "Pick the original clip".
 * Returns how many copies were removed.
 */
export async function removeExpiredCopies(
  clips: RecordStore<LocalClip>,
  retentionDays: number,
  now: Date,
  remove: (clipId: string) => Promise<void> = deleteCopy,
): Promise<number> {
  let removed = 0;
  for (const clip of await clips.all()) {
    if (!copyExpired(clip, retentionDays, now)) continue;
    await remove(clip.id);
    await clips.put({ ...clip, copy: 'none' });
    removed++;
  }
  return removed;
}
