import { Link, Outlet, useNavigation } from 'react-router';
import { Brand } from '../components/Brand';
import { StatEdgeLoader } from '../components/StatEdgeLoader';
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
  const navigation = useNavigation();
  const navigating = navigation.state !== 'idle';
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
          <Brand variant="header" />
        </Link>
        {signedIn ? (
          <div className={styles.headerEnd}>
            <OutboxPill />
            <AccountMenu />
          </div>
        ) : null}
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        {navigating ? <StatEdgeLoader variant="page" /> : null}
        {/* Keep the current screen mounted if navigation is cancelled or superseded. */}
        <div hidden={navigating}>
          <Outlet />
        </div>
      </main>
      {signedIn ? <BottomNav isAdmin={me.data?.coach.role === 'admin'} /> : null}
    </div>
  );
}
