import { strings } from '../lib/strings';
import styles from './brand.module.css';

/** The supplied StatEdge marks, with Stride kept visible as the product name. */
export function Brand({ variant }: { variant: 'header' | 'auth' }) {
  return (
    <span className={`${styles.brand} ${styles[variant]}`} role="img" aria-label={strings.app.name}>
      <span className={styles.marks} aria-hidden="true">
        <img className={styles.icon} src="/brand/statedge-icon.png" width="64" height="64" alt="" />
        <img
          className={styles.darkInk}
          src="/brand/statedge-wordmark-dark.png"
          width="2518"
          height="805"
          alt=""
        />
        <img
          className={styles.lightInk}
          src="/brand/statedge-wordmark-light.png"
          width="2458"
          height="746"
          alt=""
        />
      </span>
      <span className={styles.product} aria-hidden="true">
        Stride
      </span>
    </span>
  );
}
