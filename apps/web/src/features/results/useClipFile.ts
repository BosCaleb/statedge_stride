import { useCallback, useEffect, useState } from 'react';
import { readCopy } from '../../lib/local/clipLibrary';
import { fingerprint } from '../../lib/local/fingerprint';
import type { LocalClip } from '../../lib/local/records';

export type ClipFileState =
  | { kind: 'loading' }
  | { kind: 'ready'; file: Blob }
  /** No copy on the phone: the coach can pick the original file. */
  | { kind: 'missing' };

/**
 * The video of a clip: the copy kept on the phone, or the original picked again by the coach
 * and recognised by its fingerprint. `pick` returns false for a different file.
 */
export function useClipFile(clip: LocalClip | undefined): {
  state: ClipFileState;
  pick: (file: File) => Promise<boolean>;
} {
  const [state, setState] = useState<ClipFileState>({ kind: 'loading' });
  const id = clip?.id;
  const copy = clip?.copy;
  const expected = clip?.fingerprint;

  useEffect(() => {
    if (!id || !copy) {
      setState({ kind: 'missing' });
      return;
    }
    let live = true;
    setState({ kind: 'loading' });
    void readCopy({ id, copy }).then((file) => {
      if (live) setState(file ? { kind: 'ready', file } : { kind: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [id, copy]);

  const pick = useCallback(
    async (file: File) => {
      if (!expected || (await fingerprint(file)) !== expected) return false;
      setState({ kind: 'ready', file });
      return true;
    },
    [expected],
  );
  return { state, pick };
}
