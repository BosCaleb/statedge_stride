import { Link, Outlet } from 'react-router';
import { StatEdgeMark } from '../components/StatEdgeMark';
import { useAuth } from '../lib/auth/authContext';
import { useMe } from '../lib/apiContext';
import { useClipRetention } from '../lib/local/localQueries';
import { strings } from '../lib/strings';
import { AccountMenu } from './AccountMenu';
import { BottomNav } from './BottomNav';
import { OutboxPill } from './OutboxPill';
import styles from './shell.module.css';

/** Header, page and bottom navigation for every signed-in screen and the guide. */
export function AppShell() {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const me = useMe(signedIn);
  useClipRetention(me.data?.organisation.clipRetentionDays);
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        {strings.app.skipToContent}
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark} aria-label={strings.app.name}>
          <StatEdgeMark />
          <span className={styles.brandText} aria-hidden="true">
            <span className={styles.brandName}>{strings.app.brandName}</span>
            <span className={styles.brandSub}>{strings.app.shortName}</span>
          </span>
        </Link>
        {signedIn ? (
          <div className={styles.headerEnd}>
            <OutboxPill />
            <AccountMenu />
          </div>
        ) : null}
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
      {signedIn ? <BottomNav isAdmin={me.data?.coach.role === 'admin'} /> : null}
    </div>
  );
}
