import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { outboxStatus, useOutboxStore, type OutboxStatus } from '../lib/outbox/outboxStore';
import { strings } from '../lib/strings';
import { OutboxPanel } from './OutboxPanel';
import styles from './shell.module.css';

const ICONS: Record<OutboxStatus, IconName> = {
  saved: 'check',
  saving: 'cloud',
  offline: 'offline',
  attention: 'alert',
};

/** Saved, Saving (with count), Offline (with count) or Needs attention. Opens the outbox. */
export function OutboxPill() {
  const state = useOutboxStore();
  const [open, setOpen] = useState(false);
  const status = outboxStatus(state);
  const text =
    status === 'saved'
      ? strings.outbox.saved
      : status === 'saving'
        ? strings.outbox.saving(state.pending)
        : status === 'offline'
          ? strings.outbox.offline(state.pending)
          : strings.outbox.attention;
  return (
    <>
      <button
        type="button"
        className={`${styles.pill} ${styles[status]}`}
        aria-label={`${strings.outbox.label}: ${text}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name={ICONS[status]} size={18} />
        <span aria-hidden="true">{text}</span>
      </button>
      <OutboxPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
