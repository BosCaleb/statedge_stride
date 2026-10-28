import type { GateCheck } from '@stride/shared/analysisResult';
import { strings } from '../../lib/strings';
import styles from './analyse.module.css';

/** Quality checks in the coach's words: what was found, how to fix the shoot, the measurement. */
export function GateChecksList({ checks }: { checks: readonly GateCheck[] }) {
  return (
    <ul className={styles.checks}>
      {checks.map((c) => (
        <li key={c.id} className={styles.check}>
          <p className={styles.checkMessage}>{strings.gate.checks[c.id].message}</p>
          <p className={styles.tip}>{strings.gate.checks[c.id].tip}</p>
          <p className={styles.detail}>{strings.gate.measured(c.detail)}</p>
        </li>
      ))}
    </ul>
  );
}
