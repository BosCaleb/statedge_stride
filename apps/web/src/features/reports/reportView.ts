import type { MetricResult } from '@stride/shared/analysisResult';
import { formatDisplayDate } from '@stride/shared/dates';
import type { ReportAnalysis, ReportSnapshot } from '@stride/shared/reportSnapshot';
import { strings } from '../../lib/strings';
import { formatValue, reasonText, unitLabel } from '../results/valueFormat';

// A report snapshot in words, for the PDF and the public report page. Reads the snapshot only,
// never the analysis package, so that the public page loads no analysis code. Every value comes
// with its confidence label, and there are no target ranges or judgements.

export interface MetricLine {
  id: MetricResult['id'];
  name: string;
  value: string;
  left: string;
  right: string;
  confidence: string;
  description: string;
  reasons: string[];
}

function withUnit(value: number | null | undefined, unit: string): string {
  const text = formatValue(value, unit);
  if (text === '–') return text;
  const label = unitLabel(unit);
  return label === '°' ? `${text}°` : `${text} ${label}`;
}

function metricLine(m: MetricResult): MetricLine {
  const secondary =
    m.secondary && m.secondary.value !== null
      ? ` (${withUnit(m.secondary.value, m.secondary.unit)})`
      : '';
  return {
    id: m.id,
    name: strings.metrics.names[m.id],
    value: withUnit(m.value, m.unit) + secondary,
    left: m.bySide ? withUnit(m.bySide.left, m.unit) : '',
    right: m.bySide ? withUnit(m.bySide.right, m.unit) : '',
    confidence: strings.metrics.confidence[m.confidence],
    description: strings.metrics.descriptions[m.id],
    reasons: m.reasons.map(reasonText),
  };
}

/** The shown measurements of one analysis, in its two groups. */
export function metricLines(analysis: ReportAnalysis): {
  primary: MetricLine[];
  secondary: MetricLine[];
} {
  const primary = new Set(analysis.primary);
  return {
    primary: analysis.metrics.filter((m) => primary.has(m.id)).map(metricLine),
    secondary: analysis.metrics.filter((m) => !primary.has(m.id)).map(metricLine),
  };
}

/** The measurements the data could not support, each once with its reasons. */
export function notMeasuredLines(analysis: ReportAnalysis): { name: string; reasons: string }[] {
  return analysis.hidden.map((h) => ({
    name: strings.metrics.names[h.id],
    reasons: h.reasons.map(reasonText).join(' '),
  }));
}

export interface ChangeLine {
  name: string;
  earlier: string;
  later: string;
  change: string;
}

/** The analysis the report is mostly about: the later one of a comparison. */
export function mainAnalysis(snapshot: ReportSnapshot): ReportAnalysis {
  const later = snapshot.comparison
    ? snapshot.analyses.find((a) => a.id === snapshot.comparison?.laterAnalysisId)
    : undefined;
  const main = later ?? snapshot.analyses[snapshot.analyses.length - 1];
  if (!main) throw new Error('A report snapshot has at least one analysis');
  return main;
}

/** Earlier against later for every measurement either shows, in neutral words. */
export function changeLines(snapshot: ReportSnapshot): ChangeLine[] | null {
  const c = snapshot.comparison;
  if (!c) return null;
  const earlier = snapshot.analyses.find((a) => a.id === c.baselineAnalysisId);
  const later = snapshot.analyses.find((a) => a.id === c.laterAnalysisId);
  if (!earlier || !later) return null;
  const ids = [
    ...later.metrics.map((m) => m.id),
    ...earlier.metrics.map((m) => m.id).filter((id) => !later.metrics.some((m) => m.id === id)),
  ];
  return ids.map((id) => {
    const b = earlier.metrics.find((m) => m.id === id);
    const a = later.metrics.find((m) => m.id === id);
    const unit = a?.unit ?? b?.unit ?? '';
    let change: string = strings.compare.notMeasured;
    if (a && b && a.value !== null && b.value !== null) {
      const shown = formatValue(a.value - b.value, unit);
      const n = Number(shown);
      const direction = n === 0 ? 'same' : n > 0 ? 'higher' : 'lower';
      change =
        direction === 'same'
          ? strings.compare.directions.same
          : `${strings.compare.directions[direction]}: ${withUnit(Math.abs(a.value - b.value), unit)}`;
    }
    return {
      name: strings.metrics.names[id],
      earlier: b
        ? `${withUnit(b.value, unit)} (${strings.metrics.confidence[b.confidence]})`
        : strings.compare.notMeasured,
      later: a
        ? `${withUnit(a.value, unit)} (${strings.metrics.confidence[a.confidence]})`
        : strings.compare.notMeasured,
      change,
    };
  });
}

export function caveatLines(snapshot: ReportSnapshot): string[] {
  return snapshot.comparison?.caveats.map((c) => strings.compare.caveats[c]) ?? [];
}

/** The athlete block: label and value pairs, empty details left out. */
export function athleteBlock(snapshot: ReportSnapshot): [string, string][] {
  const t = strings.reports.pdf;
  const s = snapshot.session;
  const rows: [string, string | undefined][] = [
    [t.athlete, snapshot.athleteDisplayName],
    [t.date, formatDisplayDate(s.date)],
    [t.place, s.place],
    [t.mode, strings.sessions.modes[s.mode]],
    [t.surface, s.surface ? strings.sessions.surfaces[s.surface] : undefined],
    [t.footwear, s.footwear],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined && r[1] !== '');
}

export function noteDate(createdAt: string): string {
  return formatDisplayDate(createdAt.slice(0, 10));
}
