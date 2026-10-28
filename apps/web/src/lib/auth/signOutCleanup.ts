// Sign-out wipes what this phone holds about the organisation: the cached query data, the
// outbox, key-frame thumbnails and the clip library. Each feature registers its own cleanup,
// so that the sign-in code does not depend on every feature.

type Cleanup = () => Promise<void> | void;
const cleanups = new Set<Cleanup>();

export function onSignOut(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}

export async function runSignOutCleanup(): Promise<void> {
  const results = await Promise.allSettled([...cleanups].map(async (c) => c()));
  for (const r of results)
    if (r.status === 'rejected') console.error('sign-out cleanup failed', r.reason);
}
