import { readPreference, writePreference } from '../storage';

// Sign-out wipes what this phone holds about the organisation: the cached query data, the
// outbox, key-frame thumbnails and the clip library. Each feature registers its own cleanup,
// so that the sign-in code does not depend on every feature. A wipe that was interrupted (the
// app closed or reloaded during it) is finished on the next start.

type Cleanup = () => Promise<void> | void;
const cleanups = new Set<Cleanup>();
const UNFINISHED = 'stride.signOutUnfinished';

export function onSignOut(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}

export async function runSignOutCleanup(): Promise<void> {
  writePreference(UNFINISHED, '1');
  const results = await Promise.allSettled([...cleanups].map(async (c) => c()));
  for (const r of results)
    if (r.status === 'rejected') console.error('sign-out cleanup failed', r.reason);
  writePreference(UNFINISHED, null);
}

/** True when a sign-out started and its wipe did not finish. */
export function signOutUnfinished(): boolean {
  return readPreference(UNFINISHED) === '1';
}
