import { isMinor } from '@stride/shared/consent';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import shell from '../../app/shell.module.css';
import { ConsentBadge } from '../../components/ConsentBadge';
import form from '../../components/form.module.css';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import badge from '../../components/badge.module.css';
import { strings } from '../../lib/strings';
import { useAthletes } from './athleteData';
import styles from './athletes.module.css';

/** /athletes: search (on the phone, so no name ever goes into a URL), add, consent status. */
export function AthletesPage() {
  const athletes = useAthletes();
  const [search, setSearch] = useState('');
  const year = new Date().getUTCFullYear();
  const shown = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    const list = athletes.data ?? [];
    if (!q) return list;
    return list.filter((a) =>
      `${a.firstName} ${a.lastName} ${a.externalRef ?? ''}`.toLocaleLowerCase().includes(q),
    );
  }, [athletes.data, search]);

  return (
    <div className={shell.page}>
      <div className={styles.toolbar}>
        <h1>{strings.athletes.title}</h1>
        <Link to="/athletes/new" className={`${ui.button} ${ui.primary}`}>
          {strings.athletes.add}
        </Link>
      </div>
      {athletes.data && athletes.data.length > 0 ? (
        <div className={`${form.field} ${styles.search}`}>
          <label className={form.label} htmlFor="athlete-search">
            {strings.athletes.search}
          </label>
          <input
            id="athlete-search"
            type="search"
            className={form.input}
            placeholder={strings.athletes.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
      ) : null}
      {athletes.isPending ? (
        <LoadingState />
      ) : athletes.isError && !athletes.data ? (
        <ErrorState title={strings.errors.title} onRetry={() => void athletes.refetch()} />
      ) : (athletes.data ?? []).length === 0 ? (
        <EmptyState title={strings.athletes.empty} body={strings.athletes.emptyBody} />
      ) : shown.length === 0 ? (
        <EmptyState title={strings.athletes.noMatches} />
      ) : (
        <ul className={styles.list}>
          {shown.map((a) => (
            <li key={a.id}>
              <Link to={`/athletes/${a.id}`} className={styles.row}>
                <span className={styles.name}>
                  {a.firstName} {a.lastName}
                </span>
                <span className={styles.meta}>
                  <span>{strings.athletes.born(a.birthYear)}</span>
                  {a.externalRef ? <span>{a.externalRef}</span> : null}
                  {isMinor(a.birthYear, year) ? (
                    <span className={`${badge.badge} ${badge.neutral}`}>
                      {strings.athletes.minor}
                    </span>
                  ) : null}
                  <ConsentBadge consents={a.consents} purpose="analysis" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
