import { formatDisplayDate } from '@stride/shared/dates';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, LoadingState } from '../../components/States';
import { useMe } from '../../lib/apiContext';
import { isReadyOffline, prepareOffline } from '../../lib/offline';
import { strings } from '../../lib/strings';
import ui from '../../components/ui.module.css';
import shell from '../../app/shell.module.css';
import { useSessions } from '../sessions/sessionData';
import sessionStyles from '../sessions/sessions.module.css';
import styles from './home.module.css';

/** How many sessions Home lists. */
const RECENT_SESSIONS = 5;

type OfflineState =
  { kind: 'unknown' | 'idle' | 'ready' | 'failed' } | { kind: 'downloading'; percent: number };

function isIosBrowser(): boolean {
  const iOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && !window.matchMedia('(display-mode: standalone)').matches;
}

/** Home: shortcuts, offline readiness and recent sessions. */
export function HomePage() {
  const me = useMe();
  const [offline, setOffline] = useState<OfflineState>({ kind: 'unknown' });

  useEffect(() => {
    void isReadyOffline().then((ready) => setOffline({ kind: ready ? 'ready' : 'idle' }));
  }, []);

  const prepare = () => {
    setOffline({ kind: 'downloading', percent: 0 });
    prepareOffline((fraction) =>
      setOffline({ kind: 'downloading', percent: Math.round(fraction * 100) }),
    )
      .then(() => setOffline({ kind: 'ready' }))
      .catch(() => setOffline({ kind: 'failed' }));
  };

  const name = me.data?.coach.displayName ?? me.data?.coach.email ?? '';
  return (
    <div className={shell.page}>
      <h1>{name ? strings.home.greeting(name) : strings.home.title}</h1>
      <div className={styles.shortcuts}>
        <Link to="/import" className={`${ui.button} ${ui.primary}`}>
          {strings.home.importClips}
        </Link>
        <Link to="/device-check" className={`${ui.button} ${ui.secondary}`}>
          {strings.home.deviceCheck}
        </Link>
      </div>

      <section className={`${ui.card} ${styles.offline}`} aria-labelledby="offline-title">
        <h2 id="offline-title">{strings.home.prepareOffline}</h2>
        {offline.kind === 'ready' ? (
          <p role="status">{strings.home.readyOffline}</p>
        ) : offline.kind === 'downloading' ? (
          <>
            <progress
              className={styles.progress}
              max={100}
              value={offline.percent}
              aria-label={strings.home.prepareOffline}
            />
            <p role="status">{strings.home.preparingOffline(offline.percent)}</p>
          </>
        ) : (
          <>
            <p>
              {offline.kind === 'failed'
                ? strings.home.prepareFailed
                : strings.home.prepareOfflineHint}
            </p>
            <button
              type="button"
              className={`${ui.button} ${ui.quiet}`}
              onClick={prepare}
              disabled={offline.kind === 'unknown'}
            >
              {strings.home.prepareOffline}
            </button>
          </>
        )}
      </section>

      {isIosBrowser() ? <p className={ui.notice}>{strings.home.installIos}</p> : null}

      <RecentSessions />
    </div>
  );
}

function RecentSessions() {
  const sessions = useSessions();
  const recent = (sessions.data ?? []).slice(0, RECENT_SESSIONS);
  return (
    <section className={sessionStyles.section} aria-labelledby="recent-title">
      <div className={sessionStyles.toolbar}>
        <h2 id="recent-title">{strings.home.recentSessions}</h2>
        <Link to="/sessions/new" className={`${ui.button} ${ui.quiet}`}>
          {strings.sessions.new}
        </Link>
      </div>
      {sessions.isPending ? (
        <LoadingState />
      ) : recent.length === 0 ? (
        <EmptyState title={strings.home.noSessions} />
      ) : (
        <ul className={sessionStyles.list}>
          {recent.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className={sessionStyles.row}>
                <span className={sessionStyles.name}>{formatDisplayDate(s.sessionDate)}</span>
                <span className={sessionStyles.meta}>
                  {strings.sessions.details(strings.sessions.modes[s.mode], s.place)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
