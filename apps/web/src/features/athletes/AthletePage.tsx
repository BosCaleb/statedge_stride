import { CONSENT_PURPOSES, type ConsentPurpose } from '@stride/shared/enums';
import { formatDisplayDate } from '@stride/shared/dates';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConsentBadge } from '../../components/ConsentBadge';
import form from '../../components/form.module.css';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { useApi, useMe } from '../../lib/apiContext';
import { strings } from '../../lib/strings';
import { athleteKeys, useAthlete, useConsentHistory, useWithdrawConsent } from './athleteData';
import styles from './athletes.module.css';
import { useQueryClient } from '@tanstack/react-query';

/** /athletes/:id: details, consent per purpose, history, and the administrator's data tools. */
export function AthletePage() {
  const { id = '' } = useParams();
  const athlete = useAthlete(id);
  const history = useConsentHistory(id);
  const me = useMe();
  const withdraw = useWithdrawConsent();
  const [withdrawing, setWithdrawing] = useState<ConsentPurpose | null>(null);

  if (athlete.isPending) return <LoadingState />;
  if (!athlete.data) return <ErrorState title={strings.athlete.notFound} />;
  const a = athlete.data;
  const isAdmin = me.data?.coach.role === 'admin';

  return (
    <div className={shell.page}>
      <div className={styles.toolbar}>
        <h1>
          {a.firstName} {a.lastName}
        </h1>
        <Link to={`/athletes/${a.id}/edit`} className={`${ui.button} ${ui.quiet}`}>
          {strings.athlete.edit}
        </Link>
      </div>
      <p className={styles.meta}>
        <span>{strings.athletes.born(a.birthYear)}</span>
        {a.externalRef ? <span>{a.externalRef}</span> : null}
      </p>

      <section className={`${ui.card} ${styles.section}`} aria-labelledby="consent-heading">
        <h2 id="consent-heading">{strings.athlete.consentHeading}</h2>
        {CONSENT_PURPOSES.map((purpose) => {
          const consent = a.consents[purpose];
          return (
            <div key={purpose} className={styles.consentRow}>
              <div>
                <ConsentBadge consents={a.consents} purpose={purpose} />
                {consent ? (
                  <p className={form.hint}>
                    {strings.consent.givenByLine(
                      consent.givenByName,
                      formatDisplayDate(consent.givenOn),
                    )}
                  </p>
                ) : null}
              </div>
              {consent ? (
                <button
                  type="button"
                  className={`${ui.button} ${ui.quiet}`}
                  onClick={() => setWithdrawing(purpose)}
                >
                  {strings.athlete.withdraw}
                </button>
              ) : null}
            </div>
          );
        })}
        {CONSENT_PURPOSES.some((p) => a.consents[p] === null) ? (
          <Link to={`/athletes/${a.id}/consent`} className={`${ui.button} ${ui.primary}`}>
            {strings.athlete.recordConsent}
          </Link>
        ) : null}
        {history.data && history.data.some((c) => c.withdrawnAt) ? (
          <details>
            <summary>{strings.consent.history}</summary>
            <ul className={styles.history}>
              {history.data.map((c) => (
                <li key={c.id} className={styles.historyItem}>
                  {strings.consent.badge[c.purpose]}:{' '}
                  {strings.consent.givenByLine(c.givenByName, formatDisplayDate(c.givenOn))}
                  {c.withdrawnAt
                    ? ` · ${strings.consent.withdrawnOn(formatDisplayDate(c.withdrawnAt))}`
                    : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="history-heading">
        <h2 id="history-heading">{strings.athlete.historyHeading}</h2>
        <EmptyState title={strings.athlete.historyEmpty} />
      </section>

      {isAdmin ? <AdminTools athleteId={a.id} fullName={`${a.firstName} ${a.lastName}`} /> : null}

      <ConfirmDialog
        open={withdrawing !== null}
        title={strings.athlete.withdrawTitle}
        confirmLabel={strings.athlete.withdraw}
        danger
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawing) void withdraw(a, withdrawing);
          setWithdrawing(null);
        }}
      >
        <p>{strings.athlete.withdrawBody}</p>
      </ConfirmDialog>
    </div>
  );
}

/** Export (a data access request) and delete-everything, both needing a connection. */
function AdminTools({ athleteId, fullName }: { athleteId: string; fullName: string }) {
  const call = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'exporting' | 'exportFailed' | 'deleteFailed'>(
    'idle',
  );
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');

  const download = async () => {
    setState('exporting');
    try {
      const data = (await call('exportAthlete', { params: { id: athleteId } })).data;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `athlete-${athleteId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('exportFailed');
    }
  };

  const remove = async () => {
    setDeleting(false);
    try {
      await call('deleteAthlete', { params: { id: athleteId }, body: { confirmName: typed } });
      queryClient.removeQueries({ queryKey: athleteKeys.one(athleteId) });
      await queryClient.invalidateQueries({ queryKey: athleteKeys.all });
      void navigate('/athletes', { replace: true });
    } catch {
      setState('deleteFailed');
    }
  };

  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return (
    <section className={`${ui.card} ${styles.section}`} aria-labelledby="admin-heading">
      <h2 id="admin-heading">{strings.athlete.adminHeading}</h2>
      <p className={form.hint}>{strings.athlete.needsConnection}</p>
      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          onClick={() => void download()}
          disabled={state === 'exporting'}
        >
          {state === 'exporting' ? strings.athlete.exporting : strings.athlete.export}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.danger}`}
          onClick={() => setDeleting(true)}
        >
          {strings.athlete.delete}
        </button>
      </div>
      {state === 'exportFailed' ? (
        <p className={form.error} role="alert">
          {strings.athlete.exportFailed}
        </p>
      ) : null}
      {state === 'deleteFailed' ? (
        <p className={form.error} role="alert">
          {strings.athlete.deleteFailed}
        </p>
      ) : null}
      <ConfirmDialog
        open={deleting}
        title={strings.athlete.deleteTitle}
        confirmLabel={strings.athlete.deleteConfirm}
        danger
        confirmDisabled={norm(typed) !== norm(fullName)}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        <p>{strings.athlete.deleteBody}</p>
        <div className={form.field}>
          <label className={form.label} htmlFor="delete-name">
            {strings.athlete.deleteLabel}
          </label>
          <input
            id="delete-name"
            className={form.input}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
      </ConfirmDialog>
    </section>
  );
}
