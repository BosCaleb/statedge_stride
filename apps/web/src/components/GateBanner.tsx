import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { MetricId } from '@stride/shared/enums';
import { useId } from 'react';
import { warningEffects } from '../features/results/metricFormat';
import { strings } from '../lib/strings';
import styles from './metrics.module.css';

const names = (ids: MetricId[]) => ids.map((id) => strings.metrics.names[id]).join(', ');

/** For a result that passed with conditions: each warning, what it hid or lowered, and the fix. */
export function GateBanner({ result }: { result: AnalysisResult }) {
  const id = useId();
  if (result.gate.status !== 'conditional') return null;
  return (
    <section className={styles.banner} aria-labelledby={id}>
      <h2 id={id} className={styles.bannerTitle}>
        {strings.gate.banner}
      </h2>
      <ul className={styles.bannerList}>
        {warningEffects(result).map((e) => (
          <li key={e.check}>
            <p className={styles.bannerMessage}>{strings.gate.checks[e.check].message}</p>
            {e.hidden.length > 0 ? <p>{strings.gate.hidden(names(e.hidden))}</p> : null}
            {e.secondaryHidden.length > 0 ? (
              <p>{strings.gate.secondaryHidden(names(e.secondaryHidden))}</p>
            ) : null}
            {e.lowered.length > 0 ? <p>{strings.gate.lowered(names(e.lowered))}</p> : null}
            <p className={styles.small}>{strings.gate.checks[e.check].tip}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
