import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { strings } from '../../lib/strings';
import styles from './auth.module.css';

/** The branded frame around sign-in, the redirect callback and the invite screen. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <p className={styles.brand}>
          StatEdge <span>Stride</span>
        </p>
        {children}
        <p className={styles.footer}>
          <Link to="/guide">{strings.guide.title}</Link>
        </p>
      </div>
    </main>
  );
}
