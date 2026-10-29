import '../styles/loader.css';
import { strings } from '../lib/strings';
import { StatEdgeMark } from './StatEdgeMark';

/**
 * The StatEdge ring, mark and wordmark animation, driven by real loading state. index.html
 * carries the same markup for the wait before JavaScript runs; keep the two in step.
 */
export function StatEdgeLoader({
  variant = 'inline',
  label = strings.app.loading,
}: {
  variant?: 'screen' | 'page' | 'inline';
  label?: string;
}) {
  return (
    <div className={`se-loader se-loader--${variant}`} role="status" aria-label={label}>
      <div className="se-glow" aria-hidden="true" />
      <div className="se-stage" aria-hidden="true">
        <div className="se-rings">
          <svg viewBox="0 0 760 760" fill="none">
            <circle cx="380" cy="380" r="360" pathLength="1" />
            <circle cx="380" cy="380" r="300" pathLength="1" />
            <circle cx="380" cy="380" r="240" pathLength="1" />
          </svg>
        </div>
        <div className="se-logo">
          <StatEdgeMark size={64} />
          <div className="se-glint" />
        </div>
        <div className="se-text">
          <div className="se-word">{strings.app.brandName}</div>
          <div className="se-line" />
          <div className="se-slogan">{strings.app.slogan}</div>
        </div>
      </div>
      <p className="se-caption" aria-hidden="true">
        {label}
      </p>
    </div>
  );
}
