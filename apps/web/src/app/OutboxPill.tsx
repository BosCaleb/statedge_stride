import { Icon, type IconName } from '../components/Icon';
import { outboxStatus, useOutboxStore, type OutboxStatus } from '../lib/outbox/outboxStore';
import { strings } from '../lib/strings';
import styles from './shell.module.css';

const ICONS: Record<OutboxStatus, IconName> = {
  saved: 'check',
  saving: 'cloud',
  offline: 'offline',
  attention: 'alert',
};

/** Saved, Saving (with count), Offline (with count) or Needs attention. */
export function OutboxPill() {
  const state = useOutboxStore();
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
    <span
      className={`${styles.pill} ${styles[status]}`}
      role="status"
      aria-label={`${strings.outbox.label}: ${text}`}
    >
      <Icon name={ICONS[status]} size={18} />
      <span>{text}</span>
    </span>
  );
}
