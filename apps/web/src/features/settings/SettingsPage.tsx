import { strings } from '../../lib/strings';
import shell from '../../app/shell.module.css';

export function SettingsPage() {
  return (
    <div className={shell.page}>
      <h1>{strings.settings.title}</h1>
    </div>
  );
}
