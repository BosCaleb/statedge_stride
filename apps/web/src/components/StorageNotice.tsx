import { useEffect, useState } from 'react';
import { storageUse, type StorageUse } from '../lib/local/clipLibrary';
import { strings } from '../lib/strings';
import styles from './clip.module.css';
import ui from './ui.module.css';

/** How much of the phone's storage Stride uses, with a warning past 80 percent of the quota. */
export function StorageNotice({ refreshKey = 0 }: { refreshKey?: number }) {
  const [use, setUse] = useState<StorageUse | null>(null);
  useEffect(() => {
    let live = true;
    void storageUse().then((u) => {
      if (live) setUse(u);
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);
  if (!use) return null;
  return (
    <div role="status">
      <p className={styles.hint}>
        {strings.clips.storage(strings.clips.bytes(use.usage), strings.clips.bytes(use.quota))}
      </p>
      {use.nearlyFull ? <p className={ui.notice}>{strings.clips.storageNearlyFull}</p> : null}
    </div>
  );
}
