import '../../lib/zodSetup';
import { publicReportSchema, type PublicReport } from '@stride/shared/api/reports';
import { formatDisplayDate } from '@stride/shared/dates';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Brand } from '../../components/Brand';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { StatEdgeLoader } from '../../components/StatEdgeLoader';
import { config } from '../../lib/config';
import { strings } from '../../lib/strings';
import { mainAnalysis, metricLines, noteDate } from '../reports/reportView';
import styles from './publicReport.module.css';

// /r/:token: a shared report for an athlete, a parent or a physio. No sign-in, cookies,
// analytics or third-party requests, and none of the app's sign-in, offline or analysis code:
// this route sits outside the app root and reads two public API routes with plain fetch. The
// frames come back as images and are shown from blob URLs (the page's content security policy
// allows images from this origin, data and blob only). Expired, revoked and unknown links show
// the same message.

type State =
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'failed' }
  | { status: 'ready'; report: PublicReport; frames: Map<number, string> };

const api = (token: string, rest = '') =>
  `${config.apiBaseUrl}/v1/public/reports/${encodeURIComponent(token)}${rest}`;

async function load(token: string, signal: AbortSignal): Promise<State> {
  const res = await fetch(api(token), {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (res.status === 404 || res.status === 400) return { status: 'gone' };
  if (!res.ok) return { status: 'failed' };
  const report = publicReportSchema.parse(await res.json());
  const frames = new Map<number, string>();
  for (const frame of report.snapshot.frames) {
    const image = await fetch(api(token, `/frames/${frame.ordinal}`), {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (image.ok) frames.set(frame.ordinal, URL.createObjectURL(await image.blob()));
  }
  return { status: 'ready', report, frames };
}

/** Keeps the page out of search engines and stops it sending its address onwards. */
function usePrivatePage(title: string) {
  useEffect(() => {
    const metas = [
      ['robots', 'noindex, nofollow'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => {
      const meta = document.createElement('meta');
      meta.name = name ?? '';
      meta.content = content ?? '';
      document.head.append(meta);
      return meta;
    });
    const previous = document.title;
    document.title = title;
    return () => {
      for (const m of metas) m.remove();
      document.title = previous;
    };
  }, [title]);
}

export function PublicReportPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  usePrivatePage(strings.publicReport.pageTitle);

  useEffect(() => {
    const controller = new AbortController();
    let shown: State | null = null;
    load(token, controller.signal)
      .then((s) => {
        shown = s;
        setState(s);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'failed' });
      });
    return () => {
      controller.abort();
      if (shown?.status === 'ready')
        for (const url of shown.frames.values()) URL.revokeObjectURL(url);
    };
  }, [token]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand variant="header" />
      </header>
      <main id="main" className={styles.main}>
        {state.status === 'loading' ? (
          <StatEdgeLoader variant="page" label={strings.publicReport.loading} />
        ) : state.status === 'gone' ? (
          <Message title={strings.publicReport.gone} body={strings.publicReport.goneBody} />
        ) : state.status === 'failed' ? (
          <Message title={strings.publicReport.failed} body={strings.publicReport.failedBody} />
        ) : (
          <Report report={state.report} frames={state.frames} />
        )}
      </main>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <section className={styles.message} role="status">
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}

function Report({ report, frames }: { report: PublicReport; frames: Map<number, string> }) {
  const s = report.snapshot;
  const main = mainAnalysis(s);
  const primary = metricLines(main).primary;
  const metricsById = new Map(main.metrics.map((m) => [m.id, m]));
  return (
    <article className={styles.report} aria-labelledby="report-title">
      <header className={styles.intro}>
        <p className={styles.eyebrow}>{s.organisationName}</p>
        <h1 id="report-title">{s.title}</h1>
        <p className={styles.meta}>
          {strings.publicReport.athleteLine(
            s.athleteDisplayName,
            formatDisplayDate(s.session.date),
            strings.sessions.modes[s.session.mode],
          )}
        </p>
      </header>

      {s.frames.length > 0 ? (
        <section aria-labelledby="frames-title">
          <h2 id="frames-title">{strings.reports.pdf.keyFrames}</h2>
          <ul className={styles.frames}>
            {s.frames.map((f) => {
              const url = frames.get(f.ordinal);
              return (
                <li key={f.ordinal}>
                  <figure>
                    {url ? <img src={url} alt={f.caption} /> : null}
                    <figcaption>{f.caption}</figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="metrics-title">
        <h2 id="metrics-title">{strings.metrics.primary}</h2>
        {primary.length === 0 ? <p>{strings.results.noMetrics}</p> : null}
        <ul className={styles.metrics}>
          {primary.map((m) => {
            const result = metricsById.get(m.id);
            return (
              <li key={m.id} className={styles.metric}>
                <h3>{m.name}</h3>
                <p className={styles.value}>{m.value}</p>
                {m.left || m.right ? (
                  <p className={styles.sides}>
                    {strings.metrics.sides.left} {m.left} · {strings.metrics.sides.right} {m.right}
                  </p>
                ) : null}
                {result ? <ConfidenceBadge confidence={result.confidence} /> : null}
                <p className={styles.description}>{m.description}</p>
                {m.reasons.length > 0 ? (
                  <ul className={styles.reasons}>
                    {m.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {s.notes.length > 0 ? (
        <section aria-labelledby="notes-title">
          <h2 id="notes-title">{strings.reports.pdf.notes}</h2>
          <ul className={styles.notes}>
            {s.notes.map((n) => (
              <li key={`${n.createdAt}-${n.text.slice(0, 20)}`}>
                <span className={styles.noteDate}>{noteDate(n.createdAt)}</span> {n.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="read-title">
        <h2 id="read-title">{strings.reports.pdf.howToRead}</h2>
        <ul>
          {strings.reports.pdf.howToReadItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <p className={styles.disclaimer}>{strings.reports.pdf.disclaimer}</p>
      <p className={styles.expiry}>
        {strings.publicReport.expires(formatDisplayDate(report.expiresAt))}
      </p>
    </article>
  );
}
