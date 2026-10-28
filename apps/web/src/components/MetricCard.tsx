import type { MetricResult } from '@stride/shared/analysisResult';
import type { ReasonCode } from '@stride/shared/enums';
import { useId, useState } from 'react';
import { formatValue } from '../features/results/metricFormat';
import { strings } from '../lib/strings';
import { ConfidenceBadge } from './ConfidenceBadge';
import styles from './metrics.module.css';

export function unitLabel(unit: string): string {
  return (strings.metrics.units as Record<string, string>)[unit] ?? unit;
}

/** A reason code in the coach's words (gate:<check> uses that check's message). */
export function reasonText(code: ReasonCode): string {
  if (code.startsWith('gate:')) {
    const check = code.slice(5) as keyof typeof strings.gate.checks;
    return strings.gate.checks[check].message;
  }
  return strings.metrics.reasons[code as keyof typeof strings.metrics.reasons];
}

/**
 * One measurement: value and unit, left and right where it has sides, the confidence label, a
 * plain description of what is measured, and why the label was lowered. Tapping the value shows
 * the spread across cycles. No targets and no good or bad colouring.
 */
export function MetricCard({ metric }: { metric: MetricResult }) {
  const id = useId();
  const [showSpread, setShowSpread] = useState(false);
  const unit = unitLabel(metric.unit);
  const value = (
    <>
      <span className={styles.number}>{formatValue(metric.value, metric.unit)}</span>{' '}
      <span className={styles.unit}>{unit}</span>
    </>
  );
  const sd = metric.sd;
  return (
    <article className={styles.card} aria-labelledby={id}>
      <header className={styles.head}>
        <h3 id={id} className={styles.name}>
          {strings.metrics.names[metric.id]}
        </h3>
        <ConfidenceBadge confidence={metric.confidence} />
      </header>
      {sd !== undefined ? (
        <button
          type="button"
          className={styles.valueButton}
          aria-expanded={showSpread}
          onClick={() => setShowSpread((s) => !s)}
        >
          {value}
          <span className="visuallyHidden"> {strings.metrics.showSpread}</span>
        </button>
      ) : (
        <p className={styles.value}>{value}</p>
      )}
      {sd !== undefined && showSpread ? (
        <p className={styles.small}>
          {strings.metrics.spread(formatValue(sd, metric.unit), unit, metric.n)}
        </p>
      ) : null}
      {metric.secondary && metric.secondary.value !== null ? (
        <p className={styles.secondary}>
          {formatValue(metric.secondary.value, metric.secondary.unit)}{' '}
          {unitLabel(metric.secondary.unit)}
        </p>
      ) : null}
      {metric.bySide ? (
        <dl className={styles.sides}>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} className={styles[side]}>
              <dt>{strings.metrics.sides[side]}</dt>
              <dd>
                {formatValue(metric.bySide?.[side], metric.unit)} {unit}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className={styles.description}>{strings.metrics.descriptions[metric.id]}</p>
      {metric.reasons.length > 0 ? (
        <ul className={styles.reasons} aria-label={strings.metrics.reasonsLabel}>
          {metric.reasons.map((r) => (
            <li key={r}>{reasonText(r)}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
