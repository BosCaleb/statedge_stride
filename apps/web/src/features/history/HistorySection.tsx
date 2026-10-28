import { formatDisplayDate } from '@stride/shared/dates';
import { METRIC_IDS, type MetricId, type Mode } from '@stride/shared/enums';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router';
import form from '../../components/form.module.css';
import { unitLabel } from '../../components/MetricCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { strings } from '../../lib/strings';
import { formatValue } from '../results/metricFormat';
import { GateStatusBadge } from '../results/GateStatusBadge';
import { useAthleteHistory, type HistoryRow } from './historyData';
import styles from './history.module.css';
import type { TrendPoint } from './TrendChart';

const TrendChart = lazy(async () => ({ default: (await import('./TrendChart')).TrendChart }));

/** The athlete's analyses, two of which can be compared, and a trend of one metric. */
export function HistorySection({ athleteId }: { athleteId: string }) {
  const { rows, isPending, isError } = useAthleteHistory(athleteId);
  const [picked, setPicked] = useState<string[]>([]);
  if (isPending) return <LoadingState />;
  if (isError && rows.length === 0) return <ErrorState title={strings.errors.title} />;
  if (rows.length === 0) return <EmptyState title={strings.athlete.historyEmpty} />;
  const chosen = rows
    .filter((r) => picked.includes(r.id))
    .sort(
      (a, b) =>
        a.sessionDate.localeCompare(b.sessionDate) || a.createdAt.localeCompare(b.createdAt),
    );

  return (
    <>
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.id} className={styles.row}>
            <Link to={`/analyses/${r.id}`} className={styles.link}>
              <span className={styles.date}>{formatDisplayDate(r.sessionDate)}</span>
              <span className={styles.meta}>
                {strings.sessions.modes[r.mode]}
                <GateStatusBadge status={r.gateStatus} />
                {r.saved ? null : <span>{strings.sessions.notSaved}</span>}
              </span>
            </Link>
            <label className={styles.pick}>
              <input
                type="checkbox"
                checked={picked.includes(r.id)}
                disabled={!picked.includes(r.id) && picked.length >= 2}
                onChange={(e) =>
                  setPicked((list) =>
                    e.target.checked ? [...list, r.id] : list.filter((x) => x !== r.id),
                  )
                }
              />
              <span className="visuallyHidden">
                {strings.history.pickLabel(formatDisplayDate(r.sessionDate))}
              </span>
              <span aria-hidden="true">{strings.history.pick}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className={form.actions}>
        {chosen.length === 2 ? (
          <Link
            to={`/compare?a=${chosen[0]?.id ?? ''}&b=${chosen[1]?.id ?? ''}`}
            className={`${ui.button} ${ui.primary}`}
          >
            {strings.history.compare}
          </Link>
        ) : (
          <p className={form.hint}>{strings.history.compareHint}</p>
        )}
      </div>
      <TrendSection rows={rows} />
    </>
  );
}

/** Points of one metric in one mode, oldest first. */
export function trendPoints(rows: HistoryRow[], metric: MetricId, mode: Mode): TrendPoint[] {
  return rows
    .filter((r) => r.mode === mode)
    .flatMap((r) => {
      const m = r.metrics.find((x) => x.metricId === metric);
      return m && m.value !== null
        ? [
            {
              date: r.sessionDate,
              value: m.value,
              label: `${formatValue(m.value, m.unit)} ${unitLabel(m.unit)}`,
              confidence: m.confidence,
            },
          ]
        : [];
    })
    .reverse();
}

export function TrendSection({ rows }: { rows: HistoryRow[] }) {
  const modes = [...new Set(rows.map((r) => r.mode))];
  const [mode, setMode] = useState<Mode>(rows[0]?.mode ?? 'sprint');
  const available = useMemo(
    () =>
      METRIC_IDS.filter((id) =>
        rows.some((r) => r.mode === mode && r.metrics.some((m) => m.metricId === id)),
      ),
    [rows, mode],
  );
  const [metric, setMetric] = useState<MetricId | ''>('');
  const shown = metric && available.includes(metric) ? metric : (available[0] ?? '');
  if (!shown) return null;
  const points = trendPoints(rows, shown, mode);
  const title = strings.history.trendTitle(strings.metrics.names[shown]);
  return (
    <section className={styles.trend} aria-labelledby="trend-heading">
      <h3 id="trend-heading">{strings.history.trend}</h3>
      {modes.length > 1 ? (
        <fieldset className={form.fieldset}>
          <legend className={form.legend}>{strings.sessions.mode}</legend>
          <div className={styles.modes}>
            {modes.map((m) => (
              <label key={m} className={form.choice}>
                <input
                  type="radio"
                  name="trend-mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {strings.sessions.modes[m]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className={form.field}>
        <label className={form.label} htmlFor="trend-metric">
          {strings.history.metric}
        </label>
        <select
          id="trend-metric"
          className={form.input}
          value={shown}
          onChange={(e) => setMetric(METRIC_IDS.find((id) => id === e.target.value) ?? '')}
        >
          {available.map((id) => (
            <option key={id} value={id}>
              {strings.metrics.names[id]}
            </option>
          ))}
        </select>
      </div>
      {points.length >= 2 ? (
        <Suspense fallback={<LoadingState />}>
          <TrendChart points={points} title={title} />
        </Suspense>
      ) : (
        <p className={form.hint}>{strings.history.needTwo}</p>
      )}
      <details className={styles.values}>
        <summary>{strings.history.showValues}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{strings.sessions.date}</th>
              <th scope="col">{strings.metrics.names[shown]}</th>
              <th scope="col">{strings.history.confidence}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={`${p.date}-${i}`}>
                <td>{formatDisplayDate(p.date)}</td>
                <td>{p.label}</td>
                <td>{strings.metrics.confidence[p.confidence]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
