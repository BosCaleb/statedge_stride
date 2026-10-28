import type { ConsentSummary } from '@stride/shared/api/athletes';
import type { ConsentPurpose } from '@stride/shared/enums';
import { strings } from '../lib/strings';
import styles from './badge.module.css';

/**
 * Whether consent for a purpose is recorded. Text, not colour alone: "Analysis: consent
 * recorded" or "Analysis: no consent".
 */
export function ConsentBadge({
  consents,
  purpose,
}: {
  consents: ConsentSummary;
  purpose: ConsentPurpose;
}) {
  const given = consents[purpose] !== null;
  return (
    <span className={`${styles.badge} ${given ? styles.ok : styles.missing}`}>
      <span aria-hidden="true">{given ? '✓' : '!'}</span>
      {strings.consent.badge[purpose]}:{' '}
      {given ? strings.consent.badge.given : strings.consent.badge.missing}
    </span>
  );
}
