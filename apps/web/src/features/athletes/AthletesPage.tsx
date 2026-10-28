import { strings } from '../../lib/strings';
import shell from '../../app/shell.module.css';

export function AthletesPage() {
  return (
    <div className={shell.page}>
      <h1>{strings.athletes.title}</h1>
    </div>
  );
}
