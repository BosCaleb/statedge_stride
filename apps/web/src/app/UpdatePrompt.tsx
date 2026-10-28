import { useRegisterSW } from 'virtual:pwa-register/react';
import { strings } from '../lib/strings';
import { useJobStore } from '../stores/jobStore';
import ui from '../components/ui.module.css';
import styles from './update.module.css';

/**
 * The service worker waits until the coach chooses to reload ("prompt" mode). A running
 * analysis is never interrupted: the prompt says the update will wait for it.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
  const jobRunning = useJobStore((s) => s.running);
  if (!needRefresh) return null;
  return (
    <div className={styles.toast} role="status">
      {jobRunning ? (
        <p>{strings.update.waitingForJob}</p>
      ) : (
        <>
          <p>{strings.update.available}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.quiet}`}
              onClick={() => setNeedRefresh(false)}
            >
              {strings.update.later}
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              onClick={() => void updateServiceWorker(true)}
            >
              {strings.update.reload}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
