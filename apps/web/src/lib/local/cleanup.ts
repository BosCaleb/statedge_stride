import { deleteAllCopies } from './clipLibrary';
import { localCalibrations, localClips, localResults } from './records';
import { deleteAllThumbnails } from './thumbnails';

/** Wipes the analysis loop's data from the phone: clip copies, records and thumbnails. */
export async function clearLocalData(): Promise<void> {
  await Promise.allSettled([
    deleteAllCopies(),
    localClips.clear(),
    localCalibrations.clear(),
    localResults.clear(),
    deleteAllThumbnails(),
  ]);
}
