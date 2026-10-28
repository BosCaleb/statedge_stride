import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  localCalibrations,
  localClips,
  localResults,
  type LocalCalibration,
  type LocalClip,
  type LocalResult,
} from './records';
import { removeExpiredCopies } from './retention';

// React access to the phone's own records, through the query cache so that screens share one
// read and refresh together after a write. These never touch the network (networkMode always)
// and are not persisted by the query persister: they already live in IndexedDB.

export const localKeys = {
  all: ['local'] as const,
  clips: ['local', 'clips'] as const,
  calibrations: ['local', 'calibrations'] as const,
  results: ['local', 'results'] as const,
};

const byNewest = <T extends { createdAt?: string; importedAt?: string }>(a: T, b: T) =>
  (b.createdAt ?? b.importedAt ?? '').localeCompare(a.createdAt ?? a.importedAt ?? '');

export function useLocalClips() {
  return useQuery({
    queryKey: localKeys.clips,
    queryFn: async () => (await localClips.all()).sort(byNewest),
    networkMode: 'always',
    staleTime: Infinity,
  });
}

export function useLocalCalibrations() {
  return useQuery({
    queryKey: localKeys.calibrations,
    queryFn: async () => (await localCalibrations.all()).sort(byNewest),
    networkMode: 'always',
    staleTime: Infinity,
  });
}

export function useLocalResults() {
  return useQuery({
    queryKey: localKeys.results,
    queryFn: async () => (await localResults.all()).sort(byNewest),
    networkMode: 'always',
    staleTime: Infinity,
  });
}

export async function storeLocalClips(queryClient: QueryClient, clips: LocalClip[]) {
  for (const clip of clips) await localClips.put(clip);
  await queryClient.invalidateQueries({ queryKey: localKeys.clips });
}

export async function storeLocalCalibration(queryClient: QueryClient, cal: LocalCalibration) {
  await localCalibrations.put(cal);
  await queryClient.invalidateQueries({ queryKey: localKeys.calibrations });
}

let resultWrites: Promise<unknown> = Promise.resolve();

/** Writes land in the order they were asked for, so a late note draft never undoes a save. */
export async function storeLocalResult(queryClient: QueryClient, result: LocalResult) {
  const write = resultWrites.then(() => localResults.put(result));
  resultWrites = write.catch(() => undefined);
  await write;
  await queryClient.invalidateQueries({ queryKey: localKeys.results });
}

let retentionRan = false;

/**
 * On app start, once the organisation's retention period is known, removes clip copies older
 * than it (the spec's "local clips older than the retention period are removed on app start").
 */
export function useClipRetention(retentionDays: number | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (retentionDays === undefined || retentionRan) return;
    retentionRan = true;
    removeExpiredCopies(localClips, retentionDays, new Date())
      .then((removed) => {
        if (removed > 0) void queryClient.invalidateQueries({ queryKey: localKeys.clips });
      })
      .catch(() => undefined); // Tried again on the next start.
  }, [retentionDays, queryClient]);
}
