import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';
import { strings } from '../../lib/strings';
import styles from './auth.module.css';

/** The branded frame around sign-in, the redirect callback and the invite screen. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <Brand variant="auth" />
        </div>
        {children}
        <p className={styles.footer}>
          <Link to="/guide">{strings.guide.title}</Link> ·{' '}
          <a href="/privacy.html" target="_blank" rel="noopener">
            {strings.privacy.notice}
          </a>
        </p>
      </div>
    </main>
  );
}
