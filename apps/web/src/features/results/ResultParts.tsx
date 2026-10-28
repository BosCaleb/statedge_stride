import type { AnalysisResult, MetricResult } from '@stride/shared/analysisResult';
import type { Side } from '@stride/shared/enums';
import { useEffect, useMemo, useState } from 'react';
import form from '../../components/form.module.css';
import { MetricCard, reasonText } from '../../components/MetricCard';
import { getThumbnail, type KeyFrameKind } from '../../lib/local/thumbnails';
import { strings } from '../../lib/strings';
import { useObjectUrl } from '../../lib/useObjectUrl';
import type { frameAngles } from './frameAngles';
import { groupMetrics } from './metricFormat';
import styles from './results.module.css';

// Pieces of the result viewer that the comparison reuses.

export function MetricsSection({ result }: { result: AnalysisResult }) {
  const groups = useMemo(() => groupMetrics(result), [result]);
  return (
    <section className={styles.section} aria-labelledby="metrics-heading">
      <h2 id="metrics-heading">{strings.results.measurementsTitle}</h2>
      {groups.primary.length + groups.secondary.length === 0 ? (
        <p>{strings.results.noMetrics}</p>
      ) : null}
      {[...groups.primary, ...groups.secondary].some((m) => m.sd !== undefined) ? (
        <p className={form.hint}>{strings.metrics.spreadHint}</p>
      ) : null}
      <MetricGroup title={strings.metrics.primary} metrics={groups.primary} />
      <MetricGroup title={strings.metrics.secondary} metrics={groups.secondary} />
      {groups.notMeasured.length > 0 ? (
        <div className={styles.notMeasured}>
          <h3>{strings.metrics.notMeasured}</h3>
          <ul>
            {groups.notMeasured.map((m) => (
              <li key={m.id}>
                <strong>{strings.metrics.names[m.id]}</strong>
                {m.reasons.length > 0 ? `: ${m.reasons.map(reasonText).join(' ')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function MetricGroup({ title, metrics }: { title: string; metrics: MetricResult[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className={styles.group}>
      <h3>{title}</h3>
      <ul className={styles.cards}>
        {metrics.map((m) => (
          <li key={m.id}>
            <MetricCard metric={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AngleTable({ angles }: { angles: ReturnType<typeof frameAngles> }) {
  const fmt = (v: number | null) =>
    v === null ? strings.results.noAngle : strings.results.angle(v.toFixed(1));
  const rows: { label: string; left: number | null; right: number | null }[] = [
    { label: strings.results.angles.knee, ...angles.knee },
    { label: strings.results.angles.hip, ...angles.hip },
    { label: strings.results.angles.shin, ...angles.shin },
  ];
  const sides: Side[] = ['left', 'right'];
  return (
    <table className={styles.angles}>
      <thead>
        <tr>
          <td />
          {sides.map((side) => (
            <th key={side} scope="col">
              {strings.metrics.sides[side]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{fmt(r.left)}</td>
            <td>{fmt(r.right)}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">{strings.results.angles.trunkLean}</th>
          <td colSpan={2}>{fmt(angles.trunkLean)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** A key-frame thumbnail kept on this phone, or null when there is none. */
export function useThumbnail(analysisId: string, kind: KeyFrameKind): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void getThumbnail(analysisId, kind).then((b) => {
      if (live) setBlob(b ?? null);
    });
    return () => {
      live = false;
    };
  }, [analysisId, kind]);
  return blob;
}

export function KeyFrameButton({
  analysisId,
  kind,
  caption,
  onClick,
}: {
  analysisId: string;
  kind: KeyFrameKind;
  caption: string;
  onClick: () => void;
}) {
  const url = useObjectUrl(useThumbnail(analysisId, kind));
  return (
    <button
      type="button"
      className={styles.keyFrame}
      aria-label={strings.results.keyFrameButton(caption)}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" /> : <span className={styles.keyFramePlaceholder} />}
      <span>{caption}</span>
    </button>
  );
}
