import shell from '../../app/shell.module.css';
import { strings } from '../../lib/strings';
import styles from './guide.module.css';

/** /guide: the capture guide, available without signing in and cached for offline use. */
export function GuidePage() {
  return (
    <div className={shell.page}>
      <h1>{strings.guide.title}</h1>
      <p>{strings.guide.intro}</p>
      {strings.guide.sections.map((section, i) => (
        <section key={section.title} className={styles.section} aria-labelledby={`guide-${i}`}>
          <h2 id={`guide-${i}`}>{section.title}</h2>
          <ul className={styles.checklist}>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className={styles.section} aria-labelledby="guide-run-sheet">
        <h2 id="guide-run-sheet">{strings.guide.runSheetTitle}</h2>
        <ol className={styles.runSheet}>
          {strings.guide.runSheet.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
