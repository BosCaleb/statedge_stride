import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import ui from '../components/ui.module.css';
import { useAuth } from '../lib/auth/authContext';
import type { OutboxEntry } from '../lib/outbox/outbox';
import { useOutbox, useOutboxEntries } from '../lib/outbox/OutboxProvider';
import { useOutboxStore } from '../lib/outbox/outboxStore';
import { strings } from '../lib/strings';
import styles from './outbox.module.css';

const ENTRY_TITLES: Partial<Record<OutboxEntry['route'], string>> = {
  putAthlete: strings.athletes.title,
  putConsent: strings.consent.title,
  withdrawConsent: strings.athlete.withdraw,
};

function reasonOf(entry: OutboxEntry): string {
  const code = entry.lastError?.code as keyof typeof strings.outbox.reasons | undefined;
  return code && code in strings.outbox.reasons
    ? strings.outbox.reasons[code]
    : strings.outbox.failed;
}

/** The writes waiting to be saved: failed ones offer View, Retry and Discard. */
export function OutboxPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const outbox = useOutbox();
  const auth = useAuth();
  const entries = useOutboxEntries();
  const paused = useOutboxStore((s) => s.paused);
  const [viewing, setViewing] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<OutboxEntry | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${ui.dialog} ${styles.panel}`}
      aria-labelledby="outbox-title"
      onCancel={onClose}
    >
      <h2 id="outbox-title">{strings.outbox.title}</h2>
      {paused ? (
        <p className={ui.notice}>
          {strings.outbox.signInAgain}{' '}
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            onClick={() => void auth.signIn()}
          >
            {strings.auth.signInButton}
          </button>
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p>{strings.outbox.empty}</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.entry}>
              <div>
                <p className={styles.title}>
                  {ENTRY_TITLES[entry.route] ?? entry.route} · {entry.label}
                </p>
                <p className={styles.state}>
                  {entry.state === 'failed'
                    ? `${strings.outbox.failed}: ${reasonOf(entry)}`
                    : entry.state === 'sending'
                      ? strings.outbox.sending
                      : entry.attempts > 0
                        ? strings.outbox.retrying
                        : strings.outbox.waiting}
                </p>
                {viewing === entry.id && entry.lastError ? (
                  <p className={styles.details}>
                    {strings.outbox.details}: {entry.lastError.code}
                  </p>
                ) : null}
              </div>
              {entry.state === 'failed' ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${ui.button} ${ui.quiet}`}
                    onClick={() => setViewing(viewing === entry.id ? null : entry.id)}
                  >
                    {strings.outbox.view}
                  </button>
                  <button
                    type="button"
                    className={`${ui.button} ${ui.primary}`}
                    onClick={() => void outbox.retry(entry.id)}
                  >
                    {strings.outbox.retry}
                  </button>
                  <button
                    type="button"
                    className={`${ui.button} ${ui.quiet}`}
                    onClick={() => setDiscarding(entry)}
                  >
                    {strings.outbox.discard}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className={ui.dialogActions}>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          onClick={() => void outbox.flush()}
        >
          {strings.outbox.syncNow}
        </button>
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
          {strings.common.close}
        </button>
      </div>
      <ConfirmDialog
        open={discarding !== null}
        title={strings.outbox.discardTitle}
        confirmLabel={strings.outbox.discard}
        danger
        onCancel={() => setDiscarding(null)}
        onConfirm={() => {
          if (discarding) void outbox.discard(discarding.id);
          setDiscarding(null);
        }}
      >
        <p>{strings.outbox.discardBody}</p>
      </ConfirmDialog>
    </dialog>
  );
}
