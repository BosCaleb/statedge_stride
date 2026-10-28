import type { Confidence } from '@stride/shared/enums';
import { strings } from '../lib/strings';
import styles from './metrics.module.css';

const DOTS: Record<Confidence, number> = { high: 3, medium: 2, low: 1, unavailable: 0 };

/**
 * How far a measurement can be trusted, in words with a dot scale. Neutral colours only: the
 * label describes the data, not the athlete.
 */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={styles.confidence}>
      <span className={styles.dots} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < DOTS[confidence] ? styles.dotOn : styles.dotOff} />
        ))}
      </span>
      {strings.metrics.confidence[confidence]}
    </span>
  );
}
