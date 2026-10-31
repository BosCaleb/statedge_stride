import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { Mode, Surface } from '@stride/shared/enums';
import {
  REPORT_SNAPSHOT_VERSION,
  reportSnapshotSchema,
  shortDisplayName,
  type ReportFrame,
  type ReportSnapshot,
} from '@stride/shared/reportSnapshot';
import { comparisonCaveats } from '../compare/compareLogic';
import { groupMetrics } from '../results/metricFormat';

// The report snapshot: what the PDF is drawn from, what is stored with the athlete, and what a
// share link copies. Results only: never keypoints or the birth year, the notes the coach ticked
// and nothing else, and the athlete's full name only when the coach chose it for the PDF (the
// API puts the first name and initial in every shared copy).

export type NameStyle = 'short' | 'full';

export interface SnapshotAnalysis {
  id: string;
  createdAt: string;
  result: AnalysisResult;
}

export interface SnapshotInput {
  title: string;
  organisationName: string;
  athlete: { firstName: string; lastName: string };
  nameStyle: NameStyle;
  session: {
    date: string;
    place?: string | null;
    surface?: Surface | null;
    footwear?: string | null;
    mode: Mode;
  };
  /** One analysis, or two for a comparison: earlier first. */
  analyses: SnapshotAnalysis[];
  /** The notes the coach ticked. */
  notes: { text: string; createdAt: string }[];
  /** Three to five frames, in the order chosen. */
  frames: { label: string; caption: string }[];
  now: Date;
}

export function athleteName(athlete: SnapshotInput['athlete'], style: NameStyle): string {
  return style === 'full'
    ? `${athlete.firstName.trim()} ${athlete.lastName.trim()}`
    : shortDisplayName(athlete.firstName, athlete.lastName);
}

function reportAnalysis({ id, createdAt, result }: SnapshotAnalysis) {
  const groups = groupMetrics(result);
  return {
    id,
    createdAt,
    algorithmVersion: result.algorithmVersion,
    gateStatus: result.gate.status === 'pass' ? ('pass' as const) : ('conditional' as const),
    metrics: [...groups.primary, ...groups.secondary],
    primary: groups.primary.map((m) => m.id),
    hidden: groups.notMeasured.map((m) => ({ id: m.id, reasons: m.reasons })),
  };
}

/** Builds and checks the snapshot. Throws when the input cannot make a valid report. */
export function buildSnapshot(input: SnapshotInput): ReportSnapshot {
  const [first, second] = input.analyses;
  if (!first) throw new Error('A report needs an analysis');
  if (second && second.result.mode !== first.result.mode)
    throw new Error('A comparison needs two analyses in the same mode');
  if (input.analyses.some((a) => a.result.gate.status === 'fail'))
    throw new Error('A result that failed the quality gate cannot be reported');
  const optional = <K extends string, V>(key: K, value: V | null | undefined) =>
    value === null || value === undefined || value === '' ? {} : { [key]: value };
  const frames: ReportFrame[] = input.frames.map((f, i) => ({
    ordinal: i + 1,
    label: f.label,
    caption: f.caption,
  }));
  return reportSnapshotSchema.parse({
    schemaVersion: REPORT_SNAPSHOT_VERSION,
    title: input.title,
    organisationName: input.organisationName,
    athleteDisplayName: athleteName(input.athlete, input.nameStyle),
    session: {
      date: input.session.date,
      mode: input.session.mode,
      ...optional('place', input.session.place),
      ...optional('surface', input.session.surface),
      ...optional('footwear', input.session.footwear),
    },
    analyses: input.analyses.map(reportAnalysis),
    ...(second
      ? {
          comparison: {
            baselineAnalysisId: first.id,
            laterAnalysisId: second.id,
            caveats: comparisonCaveats(first.result, second.result),
          },
        }
      : {}),
    notes: input.notes.map((n) => ({ text: n.text, createdAt: n.createdAt })),
    frames,
    generatedAt: input.now.toISOString(),
  });
}
