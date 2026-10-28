import { strings } from '../../lib/strings';
import shell from '../../app/shell.module.css';

/** /guide: the capture guide, available without signing in and cached for offline use. */
export function GuidePage() {
  return (
    <div className={shell.page}>
      <h1>{strings.guide.title}</h1>
      <p>{strings.guide.intro}</p>
    </div>
  );
}
