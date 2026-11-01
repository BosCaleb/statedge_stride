// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { strings } from '../../lib/strings';
import { buildSnapshot } from './buildSnapshot';
import { makeReportPdf } from './reportPdf';

// The PDF made from a fixed snapshot, read back as text: the disclaimer, the measurement names
// with their confidence labels, the notes chosen and the footer are there, and no value of a
// measurement that was not shown.

const jpeg = new Uint8Array(readFileSync(new URL('./testdata/frame.jpg', import.meta.url)));
const base = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' }).result;
const later = runSynthetic(generateGait({ noisePx: 1, seed: 3 }), { mode: 'distance' }).result;

/** Cadence measured, then hidden: its value stays in the result but must not reach the PDF. */
const HIDDEN_VALUE = 187.654;
const withHiddenCadence: AnalysisResult = {
  ...base,
  metrics: base.metrics.map((m) =>
    m.id === 'cadence'
      ? { ...m, value: HIDDEN_VALUE, confidence: 'unavailable', reasons: ['few_cycles'] }
      : m,
  ),
};

async function pdfText(blob: Blob): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    );
  }
  return pages;
}

const ids = {
  a: '0b6c1f0e-5d1a-4c8e-9a9c-111111111111',
  b: '0b6c1f0e-5d1a-4c8e-9a9c-222222222222',
};
const frames = [
  { label: 'a1:ic', caption: 'Right foot, initial contact' },
  { label: 'a1:mid', caption: 'Right foot, mid-stance' },
  { label: 'a1:to', caption: 'Right foot, toe-off' },
];

let single: string[];
let comparison: string[];

beforeAll(async () => {
  const snapshot = buildSnapshot({
    title: strings.reports.titles.single,
    organisationName: 'Test School',
    athlete: { firstName: 'Lerato', lastName: 'Molefe' },
    nameStyle: 'short',
    session: { date: '2026-03-14', mode: 'distance', place: 'Main track' },
    analyses: [{ id: ids.a, createdAt: '2026-03-14T08:00:00.000Z', result: withHiddenCadence }],
    notes: [{ text: 'Relaxed shoulders today.', createdAt: '2026-03-14T09:00:00.000Z' }],
    frames,
    now: new Date('2026-03-15T10:00:00.000Z'),
  });
  single = await pdfText(
    await makeReportPdf(
      snapshot,
      frames.map((f) => ({ caption: f.caption, jpeg })),
    ),
  );
  const compared = buildSnapshot({
    title: strings.reports.titles.comparison,
    organisationName: 'Test School',
    athlete: { firstName: 'Lerato', lastName: 'Molefe' },
    nameStyle: 'full',
    session: { date: '2026-03-14', mode: 'distance' },
    analyses: [
      { id: ids.a, createdAt: '2026-03-01T08:00:00.000Z', result: base },
      { id: ids.b, createdAt: '2026-03-14T08:00:00.000Z', result: later },
    ],
    notes: [],
    frames,
    now: new Date('2026-03-15T10:00:00.000Z'),
  });
  comparison = await pdfText(
    await makeReportPdf(
      compared,
      frames.map((f) => ({ caption: f.caption, jpeg })),
    ),
  );
}, 60_000);

describe('the report PDF', () => {
  it('carries the disclaimer, the title, the organisation and the athlete', () => {
    const all = single.join(' ');
    expect(all).toContain(strings.reports.pdf.disclaimer);
    expect(all).toContain(strings.reports.titles.single);
    expect(all).toContain('Test School');
    expect(all).toContain('Lerato M.');
    expect(all).not.toContain('Molefe');
    expect(all).toContain('Main track');
  });

  it('names each measurement with its confidence label and description', () => {
    const all = single.join(' ');
    expect(all).toContain(strings.metrics.names.contact_time);
    expect(all).toContain(strings.metrics.descriptions.contact_time);
    expect(all).toMatch(/High confidence|Medium confidence|Low confidence/);
    expect(all).toContain(strings.metrics.primary.toUpperCase());
  });

  it('lists a hidden measurement under not measured, with its reason and no value', () => {
    const all = single.join(' ');
    expect(all).toContain(strings.metrics.notMeasured);
    expect(all).toContain(
      `${strings.metrics.names.cadence}: ${strings.metrics.reasons.few_cycles}`,
    );
    expect(all).not.toContain('187');
  });

  it('prints the chosen notes, the frame captions and how to read it', () => {
    const all = single.join(' ');
    expect(all).toContain('Relaxed shoulders today.');
    expect(all).toContain('Right foot, mid-stance');
    expect(all).toContain(strings.reports.pdf.howToReadItems[0]);
  });

  it('has a footer with the algorithm version and page numbers on every page', () => {
    single.forEach((page, i) => {
      expect(page).toContain(
        strings.reports.pdf.footer(base.algorithmVersion, '15/03/2026', i + 1, single.length),
      );
    });
  });

  it('compares two analyses in neutral words, with the full name when chosen', () => {
    const all = comparison.join(' ');
    expect(all).toContain(strings.reports.pdf.comparisonTitle.toUpperCase());
    expect(all).toContain('Lerato Molefe');
    expect(all).toMatch(/Higher|Lower|No change/);
    expect(all).not.toMatch(/\b(better|worse|good|bad)\b/i);
  });
});
