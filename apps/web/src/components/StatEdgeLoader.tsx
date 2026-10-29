import '../styles/loader.css';

/** The supplied StatEdge ring, logo and wordmark animation, driven by real loading state. */
export function StatEdgeLoader({
  variant = 'inline',
  label = 'Loading StatEdge Stride',
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
          <img src="/brand/statedge-icon.png" width="530" height="520" alt="" />
          <div className="se-glint" />
        </div>
        <div className="se-text">
          <div className="se-word">
            STAT<span>EDGE</span>
          </div>
          <div className="se-line" />
          <div className="se-slogan">SMARTER DATA. SHARPER DECISIONS</div>
        </div>
      </div>
      <p className="se-caption" aria-hidden="true">
        {label}
      </p>
    </div>
  );
}
