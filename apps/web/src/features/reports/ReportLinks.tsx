import { formatDisplayDate } from '@stride/shared/dates';
import { useState } from 'react';
import { Link } from 'react-router';
import form from '../../components/form.module.css';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { strings } from '../../lib/strings';
import { useAthleteReports } from './reportData';
import styles from './reports.module.css';

// Ways into reports: the button on a saved result or a comparison, and an athlete's list of
// reports with their link expiry, where a link can be found again to revoke it.

/** Opens the builder for a new report. A saved result is needed: the report is stored with it. */
export function MakeReportButton({
  analysisId,
  compareId,
  saved,
}: {
  analysisId: string;
  compareId?: string;
  saved: boolean;
}) {
  // A new report gets its id once, when the button first shows.
  const [reportId] = useState(() => crypto.randomUUID());
  if (!saved) return <p className={form.hint}>{strings.reports.makeReportHint}</p>;
  const query = new URLSearchParams({ a: analysisId, ...(compareId ? { b: compareId } : {}) });
  return (
    <Link
      className={`${ui.button} ${ui.secondary}`}
      to={`/reports/${reportId}?${query.toString()}`}
    >
      {strings.reports.makeReport}
    </Link>
  );
}

export function AthleteReports({ athleteId }: { athleteId: string }) {
  const reports = useAthleteReports(athleteId);
  if (reports.isPending) return <LoadingState />;
  if (reports.isError && !reports.data) return <ErrorState title={strings.errors.title} />;
  const items = reports.data ?? [];
  if (items.length === 0) return <p className={form.hint}>{strings.reports.listEmpty}</p>;
  return (
    <ul className={styles.list}>
      {items.map((r) => (
        <li key={r.id}>
          <Link to={`/reports/${r.id}`}>
            {strings.reports.listItem(formatDisplayDate(r.sessionDate), r.title)}
          </Link>
          <span className={styles.subtitle}>
            {r.share
              ? strings.reports.linkOpenUntil(formatDisplayDate(r.share.expiresAt))
              : strings.reports.noLink}
          </span>
        </li>
      ))}
    </ul>
  );
}
