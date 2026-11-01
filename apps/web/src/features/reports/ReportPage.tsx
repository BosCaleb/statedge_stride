import type { DecodedKeypoints } from '@stride/analysis/skp1';
import type { Note } from '@stride/shared/api/analyses';
import type { Athlete } from '@stride/shared/api/athletes';
import { formatDisplayDate } from '@stride/shared/dates';
import { LIMITS } from '@stride/shared/limits';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ClipPicker } from '../../components/ClipPicker';
import form from '../../components/form.module.css';
import { FrameCanvas, type FrameCanvasHandle } from '../../components/FrameCanvas';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { useMe } from '../../lib/apiContext';
import { strings } from '../../lib/strings';
import { useAthlete } from '../athletes/athleteData';
import { useAthleteHistory } from '../history/historyData';
import { useAnalysisSource, type AnalysisSource } from '../results/analysisSource';
import { useClipFile, type ClipFileState } from '../results/useClipFile';
import { useKeypoints } from '../results/useKeypoints';
import { useSession } from '../sessions/sessionData';
import { athleteName, buildSnapshot, type NameStyle } from './buildSnapshot';
import {
  renderChosenFrame,
  useAutoFrames,
  type AutoFrames,
  type FrameOption,
  type FramePrefix,
} from './frameOptions';
import { useReport, useSaveReport } from './reportData';
import styles from './reports.module.css';
import { ShareSection } from './ShareSection';

// /reports/:id. With ?a=<analysis> (and ?b=<analysis> for a comparison) it builds a report:
// what it covers, three to five key frames, the notes to include and the name style, then the
// PDF, made on the phone and saved with the athlete. Without, it shows a saved report and its
// share link.

const MIN_FRAMES = 3;

export function ReportPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const a = params.get('a');
  if (a) return <ReportBuilder reportId={id} mainId={a} compareId={params.get('b') ?? ''} />;
  return <SavedReport reportId={id} />;
}

function SavedReport({ reportId }: { reportId: string }) {
  const report = useReport(reportId);
  const athlete = useAthlete(report.data?.athleteId ?? '');
  if (report.isPending) return <LoadingState />;
  if (!report.data) return <ErrorState title={strings.reports.notFound} />;
  const r = report.data;
  const analysisId = r.snapshot.comparison?.laterAnalysisId ?? r.snapshot.analyses[0]?.id;
  return (
    <div className={shell.page}>
      <header className={styles.header}>
        <h1>{r.title}</h1>
        <p className={styles.subtitle}>
          {strings.reports.listItem(
            formatDisplayDate(r.snapshot.session.date),
            strings.sessions.modes[r.snapshot.session.mode],
          )}
        </p>
      </header>
      <ShareSection report={r} athlete={athlete.data} />
      {analysisId ? (
        <p>
          <Link to={`/analyses/${analysisId}`}>{strings.reports.makeAnother}</Link>
        </p>
      ) : null}
    </div>
  );
}

interface Side {
  source: AnalysisSource | null;
  file: ClipFileState;
  pick: (file: File) => Promise<boolean>;
  keypoints: DecodedKeypoints | null;
  auto: AutoFrames;
}

function useSide(
  source: AnalysisSource | null,
  prefix: FramePrefix,
  comparisonSide: 'earlier' | 'later' | null,
): Side {
  const { state: file, pick } = useClipFile(source?.clip);
  const keypoints = useKeypoints(source?.keypoints);
  const auto = useAutoFrames(source, prefix, comparisonSide, file, keypoints);
  return { source, file, pick, keypoints, auto };
}

function ReportBuilder({
  reportId,
  mainId,
  compareId,
}: {
  reportId: string;
  mainId: string;
  compareId: string;
}) {
  const main = useAnalysisSource(mainId);
  const other = useAnalysisSource(compareId);
  if (main.status === 'loading') return <LoadingState />;
  if (main.status === 'offline') return <ErrorState title={strings.errors.offline} />;
  if (main.status === 'missing') return <ErrorState title={strings.results.notFound} />;
  if (!main.source.saved || main.source.result.gate.status === 'fail')
    return <ErrorState title={strings.reports.makeReportHint} />;
  const second = compareId && other.status === 'ready' ? other.source : null;
  if (compareId && other.status === 'loading') return <LoadingState />;
  return (
    <Builder
      key={`${mainId}/${second?.id ?? ''}`}
      reportId={reportId}
      main={main.source}
      second={second}
    />
  );
}

function Builder({
  reportId,
  main,
  second,
}: {
  reportId: string;
  main: AnalysisSource;
  second: AnalysisSource | null;
}) {
  const [, setParams] = useSearchParams();
  const me = useMe();
  const athlete = useAthlete(main.athleteId);
  const history = useAthleteHistory(main.athleteId);
  // Earlier first: the opened analysis is the later one unless the other came after it.
  const [earlier, later] =
    second && second.createdAt > main.createdAt
      ? [main, second]
      : second
        ? [second, main]
        : [main, null];
  const session = useSession((later ?? earlier).sessionId);
  const comparing = later !== null;
  const first = useSide(earlier, 'a1', comparing ? 'earlier' : null);
  const last = useSide(later, 'a2', 'later');

  const [added, setAdded] = useState<FrameOption[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  const [nameStyle, setNameStyle] = useState<NameStyle>('short');
  const [pdf, setPdf] = useState<
    | { status: 'idle' }
    | { status: 'making' }
    | { status: 'failed' }
    | { status: 'ready'; url: string; blob: Blob }
  >({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  const saveReport = useSaveReport();

  const options = useMemo(() => {
    const auto = (side: Side) => (side.auto.status === 'ready' ? side.auto.frames : []);
    return [...auto(first), ...(later ? auto(last) : []), ...added];
  }, [first, last, later, added]);
  const byLabel = new Map(options.map((o) => [o.label, o]));

  // Start with the three automatic frames of the analysis the report is mostly about.
  const defaulted = useRef(false);
  const mainSide = later ? last : first;
  useEffect(() => {
    if (defaulted.current || mainSide.auto.status !== 'ready') return;
    defaulted.current = true;
    setChosen(mainSide.auto.frames.map((f) => f.label));
  }, [mainSide.auto]);

  useEffect(
    () => () => {
      if (pdf.status === 'ready') URL.revokeObjectURL(pdf.url);
    },
    [pdf],
  );

  // Saved results passed the gate, so every saved row of the same mode can be compared.
  const candidates = history.rows.filter(
    (r) => r.saved && r.id !== main.id && r.mode === main.result.mode,
  );
  const notes: Note[] = [...(earlier?.notes ?? []), ...(later?.notes ?? [])];
  const frames = chosen.map((l) => byLabel.get(l)).filter((f): f is FrameOption => f !== undefined);
  const s = session.data?.session;
  const ready =
    athlete.data !== undefined &&
    me.data !== undefined &&
    s !== undefined &&
    frames.length >= MIN_FRAMES &&
    frames.length <= LIMITS.maxReportFrames;

  const toggle = (label: string) =>
    setChosen((list) =>
      list.includes(label)
        ? list.filter((l) => l !== label)
        : list.length < LIMITS.maxReportFrames
          ? [...list, label]
          : list,
    );

  const make = async () => {
    if (!ready || !athlete.data || !me.data || !s) return;
    setPdf({ status: 'making' });
    try {
      const snapshot = buildSnapshot({
        title: comparing ? strings.reports.titles.comparison : strings.reports.titles.single,
        organisationName: me.data.organisation.name,
        athlete: athlete.data,
        nameStyle,
        session: {
          date: s.sessionDate,
          place: s.place,
          surface: s.surface,
          footwear: s.footwear,
          mode: main.result.mode,
        },
        analyses: [earlier, later]
          .filter((x): x is AnalysisSource => x !== null)
          .map((x) => ({ id: x.id, createdAt: x.createdAt, result: x.result })),
        notes: notes
          .filter((n) => noteIds.has(n.id))
          .map((n) => ({ text: n.body, createdAt: n.createdAt })),
        frames: frames.map((f) => ({ label: f.label, caption: f.caption })),
        now: new Date(),
      });
      const jpegs = await Promise.all(
        frames.map(async (f) => ({
          caption: f.caption,
          jpeg: new Uint8Array(await f.jpeg.arrayBuffer()),
        })),
      );
      const { makeReportPdf } = await import('./reportPdf');
      const blob = await makeReportPdf(snapshot, jpegs);
      await saveReport({
        reportId,
        athleteId: main.athleteId,
        snapshot,
        frames: frames.map((f) => f.jpeg),
        label: strings.reports.outboxLabel(
          shortDisplayName(athlete.data.firstName, athlete.data.lastName),
        ),
      });
      setSaved(true);
      setPdf({ status: 'ready', blob, url: URL.createObjectURL(blob) });
    } catch {
      setPdf({ status: 'failed' });
    }
  };

  const fileName = strings.reports.fileName(s?.sessionDate ?? main.createdAt.slice(0, 10));
  const pdfFile =
    pdf.status === 'ready' ? new File([pdf.blob], fileName, { type: 'application/pdf' }) : null;
  const canSend =
    pdfFile !== null &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [pdfFile] });

  return (
    <div className={shell.page}>
      <header className={styles.header}>
        <h1>{strings.reports.builderTitle}</h1>
        {athlete.data ? (
          <p className={styles.subtitle}>
            {`${athlete.data.firstName} ${athlete.data.lastName}`} ·{' '}
            {strings.sessions.modes[main.result.mode]}
          </p>
        ) : null}
      </header>

      <section className={styles.section} aria-labelledby="covers-heading">
        <h2 id="covers-heading">{strings.reports.analysesTitle}</h2>
        <div className={form.field}>
          <label className={form.label} htmlFor="report-compare">
            {strings.reports.compareLabel}
          </label>
          <select
            id="report-compare"
            className={form.input}
            aria-describedby="report-compare-hint"
            value={second?.id ?? ''}
            onChange={(e) =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  if (e.target.value) next.set('b', e.target.value);
                  else next.delete('b');
                  return next;
                },
                { replace: true },
              )
            }
          >
            <option value="">{strings.reports.compareNone}</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {strings.reports.compareOption(formatDisplayDate(r.sessionDate))}
              </option>
            ))}
          </select>
          <p id="report-compare-hint" className={form.hint}>
            {strings.reports.compareHint}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="frames-heading">
        <h2 id="frames-heading">{strings.reports.framesTitle}</h2>
        <p className={form.hint}>
          {strings.reports.framesHint(MIN_FRAMES, LIMITS.maxReportFrames)}{' '}
          <span role="status">
            {strings.reports.framesCount(chosen.length, LIMITS.maxReportFrames)}
          </span>
        </p>
        <FramePicker side={first} />
        {later ? <FramePicker side={last} /> : null}
        <ul className={styles.frameGrid}>
          {options.map((o) => {
            const at = chosen.indexOf(o.label);
            return (
              <li key={o.label}>
                <label className={styles.frameChoice}>
                  <input
                    type="checkbox"
                    checked={at >= 0}
                    disabled={at < 0 && chosen.length >= LIMITS.maxReportFrames}
                    onChange={() => toggle(o.label)}
                  />
                  <BlobImage blob={o.jpeg} />
                  <span>
                    {at >= 0 ? <strong className={styles.order}>{at + 1}</strong> : null}
                    {o.caption}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <AddFrame
          side={mainSide}
          prefix={later ? 'a2' : 'a1'}
          comparisonSide={comparing ? 'later' : null}
          onAdd={(f) => {
            setAdded((list) => [...list.filter((x) => x.label !== f.label), f]);
            setChosen((list) =>
              list.includes(f.label) || list.length >= LIMITS.maxReportFrames
                ? list
                : [...list, f.label],
            );
          }}
        />
      </section>

      <section className={styles.section} aria-labelledby="report-notes-heading">
        <h2 id="report-notes-heading">{strings.reports.notesTitle}</h2>
        {notes.length === 0 ? (
          <p className={form.hint}>{strings.reports.noNotes}</p>
        ) : (
          <fieldset className={form.fieldset}>
            <legend className={form.hint}>{strings.reports.notesHint}</legend>
            {notes.map((n) => (
              <label key={n.id} className={form.choice}>
                <input
                  type="checkbox"
                  checked={noteIds.has(n.id)}
                  onChange={() =>
                    setNoteIds((ids) => {
                      const next = new Set(ids);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    })
                  }
                />
                <span>
                  {formatDisplayDate(n.createdAt.slice(0, 10))}: {n.body}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      {athlete.data ? (
        <section className={styles.section} aria-labelledby="name-heading">
          <h2 id="name-heading">{strings.reports.nameTitle}</h2>
          <NameChoice athlete={athlete.data} value={nameStyle} onChange={setNameStyle} />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="pdf-heading">
        <h2 id="pdf-heading" className="visuallyHidden">
          {strings.reports.makePdf}
        </h2>
        <div className={form.actions}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={!ready || pdf.status === 'making'}
            onClick={() => void make()}
          >
            {pdf.status === 'making' ? strings.reports.makingPdf : strings.reports.makePdf}
          </button>
        </div>
        {pdf.status === 'failed' ? (
          <p className={form.error} role="alert">
            {strings.reports.pdfFailed}
          </p>
        ) : null}
        {pdf.status === 'ready' ? (
          <>
            <p role="status">{strings.reports.pdfReady}</p>
            <div className={form.actions}>
              <a className={`${ui.button} ${ui.secondary}`} href={pdf.url} download={fileName}>
                {strings.reports.download}
              </a>
              {canSend && pdfFile ? (
                <button
                  type="button"
                  className={`${ui.button} ${ui.quiet}`}
                  onClick={() =>
                    void navigator
                      .share({ files: [pdfFile], title: fileName })
                      .catch(() => undefined)
                  }
                >
                  {strings.reports.sharePdf}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {saved ? (
        <>
          <p className={ui.notice}>{strings.reports.savedNote}</p>
          <SavedShare reportId={reportId} athlete={athlete.data} />
        </>
      ) : null}
    </div>
  );
}

/** The share section once the report has reached the server. */
function SavedShare({ reportId, athlete }: { reportId: string; athlete: Athlete | undefined }) {
  const report = useReport(reportId);
  if (!report.data) return null;
  return <ShareSection report={report.data} athlete={athlete} />;
}

function NameChoice({
  athlete,
  value,
  onChange,
}: {
  athlete: Athlete;
  value: NameStyle;
  onChange: (style: NameStyle) => void;
}) {
  return (
    <fieldset className={form.fieldset}>
      <legend className="visuallyHidden">{strings.reports.nameTitle}</legend>
      {(['short', 'full'] as const).map((style) => (
        <label key={style} className={form.choice}>
          <input
            type="radio"
            name="name-style"
            checked={value === style}
            onChange={() => onChange(style)}
          />
          <span>
            {style === 'short'
              ? strings.reports.nameShort(athleteName(athlete, 'short'))
              : strings.reports.nameFull(athleteName(athlete, 'full'))}
          </span>
        </label>
      ))}
      <p className={form.hint}>{strings.reports.nameHint}</p>
    </fieldset>
  );
}

/** When an analysis's key frames are not on the phone: pick the clip to draw them. */
function FramePicker({ side }: { side: Side }) {
  const [wrong, setWrong] = useState(false);
  if (side.auto.status === 'loading' && side.file.kind === 'ready')
    return <p role="status">{strings.reports.renderingFrames}</p>;
  if (side.auto.status !== 'needsClip' || !side.source?.clip?.fingerprint) return null;
  return (
    <div className={styles.picker}>
      <p>{strings.reports.framesNeedClip}</p>
      <ClipPicker
        label={strings.reports.pickClip}
        multiple={false}
        onPick={(files) => {
          const [f] = files;
          if (f) void side.pick(f).then((ok) => setWrong(!ok));
        }}
      />
      {wrong ? (
        <p className={form.error} role="alert">
          {strings.reports.wrongClip}
        </p>
      ) : null}
    </div>
  );
}

/** Any other frame of the clip: move the player to it, then add it. */
function AddFrame({
  side,
  prefix,
  comparisonSide,
  onAdd,
}: {
  side: Side;
  prefix: FramePrefix;
  comparisonSide: 'earlier' | 'later' | null;
  onAdd: (frame: FrameOption) => void;
}) {
  const player = useRef<FrameCanvasHandle>(null);
  const [frame, setFrame] = useState(side.source?.result.keyFrames?.icFrame ?? 0);
  const [busy, setBusy] = useState(false);
  const source = side.source;
  if (!source || side.file.kind !== 'ready' || !side.keypoints) return null;
  const file = side.file.file;
  const keypoints = side.keypoints;
  return (
    <div className={styles.addFrame}>
      <p className={form.hint}>{strings.reports.addFrameHint}</p>
      <FrameCanvas
        ref={player}
        file={file}
        keypoints={keypoints}
        initialFrame={frame}
        onFrame={setFrame}
      />
      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void renderChosenFrame(file, keypoints, source, frame, prefix, comparisonSide)
              .then(onAdd)
              .finally(() => setBusy(false));
          }}
        >
          {strings.reports.addFrame}
        </button>
      </div>
    </div>
  );
}

function BlobImage({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img className={styles.frameImage} src={url} alt="" /> : null;
}
