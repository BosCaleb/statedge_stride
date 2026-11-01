import { strings } from '../lib/strings';
import { StatEdgeMark } from './StatEdgeMark';
import styles from './brand.module.css';

/**
 * The StatEdge lockup, as in Tournament Manager: the mark, the wordmark, and the product as an
 * orange tracked label under it. On the navy header, and larger at the top of the sign-in card.
 */
export function Brand({ variant }: { variant: 'header' | 'auth' }) {
  return (
    <span className={`${styles.brand} ${styles[variant]}`} role="img" aria-label={strings.app.name}>
      <StatEdgeMark size={variant === 'auth' ? 48 : 36} />
      <span className={styles.text} aria-hidden="true">
        <span className={styles.name}>{strings.app.brandName}</span>
        <span className={styles.product}>{strings.app.shortName}</span>
      </span>
    </span>
  );
}
