import { formatDisplayDate } from '@stride/shared/dates';
import type { ReportSnapshot } from '@stride/shared/reportSnapshot';
import { strings } from '../../lib/strings';
import {
  athleteBlock,
  caveatLines,
  changeLines,
  mainAnalysis,
  metricLines,
  noteDate,
  notMeasuredLines,
  type MetricLine,
} from './reportView';

// The report as an A4 portrait PDF, made on the phone. jsPDF, its table plugin and the fonts are
// imported here only, and this module is imported only when a PDF is made, so none of them is in
// the first bundle. Text is real text (selectable), in Inter with Oswald headings. Layout: header
// with the StatEdge wordmark, organisation, title and an orange rule; the athlete block; the key
// frames; the main and further measurements; the comparison; what was not measured; the notes;
// how to read it; the disclaimer; and a footer on every page.

export interface PdfFrame {
  caption: string;
  jpeg: Uint8Array;
}

const NAVY: [number, number, number] = [13, 28, 62];
const ORANGE: [number, number, number] = [244, 120, 32];
const MUTED: [number, number, number] = [74, 96, 128];
const RULE: [number, number, number] = [209, 219, 232];
const PAGE = { width: 210, height: 297, margin: 18, bottom: 280 };
const CONTENT = PAGE.width - 2 * PAGE.margin;

interface WithTable {
  lastAutoTable?: { finalY?: number };
}

export async function makeReportPdf(
  snapshot: ReportSnapshot,
  frames: readonly PdfFrame[],
): Promise<Blob> {
  const [{ jsPDF }, { autoTable }, { PDF_FONTS, drawable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./pdfFonts'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (const f of PDF_FONTS) {
    doc.addFileToVFS(f.file, f.data);
    doc.addFont(f.file, f.family, f.style);
  }
  const t = strings.reports.pdf;
  const text = (s: string) => drawable(s);
  doc.setProperties({ title: text(snapshot.title), creator: strings.app.name });

  let y = PAGE.margin;
  const room = (needed: number) => {
    if (y + needed > PAGE.bottom) {
      doc.addPage();
      y = PAGE.margin;
    }
  };
  const tableEnd = () => (doc as unknown as WithTable).lastAutoTable?.finalY ?? y;
  const heading = (label: string) => {
    room(16);
    y += 4;
    doc.setFillColor(...ORANGE);
    doc.rect(PAGE.margin, y - 4, 1.2, 5, 'F');
    doc.setFont('Oswald', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...NAVY);
    doc.text(text(label.toUpperCase()), PAGE.margin + 3.5, y, { charSpace: 0.3 });
    y += 4;
  };
  const paragraph = (s: string, size = 9, color = NAVY) => {
    doc.setFont('Inter', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text(s), CONTENT) as string[];
    const height = lines.length * size * 0.42;
    room(height + 2);
    doc.text(lines, PAGE.margin, y + size * 0.35);
    y += height + 2;
  };
  const tableBase = {
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: PAGE.height - PAGE.bottom },
    styles: {
      font: 'Inter',
      fontSize: 8,
      cellPadding: 1.6,
      textColor: NAVY,
      lineColor: RULE,
      lineWidth: 0.2,
    },
    headStyles: { font: 'Inter', fontStyle: 'bold' as const, fillColor: NAVY, textColor: 255 },
  };

  // Header: the StatEdge wordmark with the product under it, the organisation, the title, a rule.
  doc.setFont('Oswald', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...NAVY);
  doc.text('STATEDGE', PAGE.margin, y + 5, { charSpace: 0.6 });
  doc.setFont('Inter', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...ORANGE);
  doc.text(t.product.toUpperCase(), PAGE.margin, y + 9.5, { charSpace: 1 });
  doc.setFont('Inter', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(text(snapshot.organisationName), PAGE.width - PAGE.margin, y + 5, { align: 'right' });
  y += 19;
  doc.setFont('Oswald', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text(text(snapshot.title), PAGE.margin, y);
  y += 3.5;
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.9);
  doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
  y += 4;

  // Athlete block.
  autoTable(doc, {
    ...tableBase,
    startY: y,
    theme: 'plain',
    body: athleteBlock(snapshot).map(([label, value]) => [text(label), text(value)]),
    styles: { ...tableBase.styles, lineWidth: 0, fontSize: 9, cellPadding: 0.9 },
    columnStyles: { 0: { cellWidth: 26, textColor: MUTED, fontStyle: 'bold' } },
  });
  y = tableEnd() + 3;

  // Key frames, side by side, each with its caption under it.
  if (frames.length > 0) {
    heading(t.keyFrames);
    const gap = 3;
    const width = (CONTENT - gap * (frames.length - 1)) / frames.length;
    const sized = frames.map((f) => {
      const p = doc.getImageProperties(f.jpeg);
      const scale = Math.min(width / p.width, 62 / p.height);
      return { ...f, w: p.width * scale, h: p.height * scale };
    });
    const tallest = Math.max(...sized.map((f) => f.h));
    room(tallest + 12);
    doc.setFont('Inter', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    sized.forEach((f, i) => {
      const x = PAGE.margin + i * (width + gap) + (width - f.w) / 2;
      doc.addImage(f.jpeg, 'JPEG', x, y, f.w, f.h);
      const caption = doc.splitTextToSize(text(f.caption), width) as string[];
      doc.text(caption, PAGE.margin + i * (width + gap), y + tallest + 3.5);
    });
    y += tallest + 11;
  }

  // Measurements of the main analysis: the main group, then the others.
  const main = mainAnalysis(snapshot);
  const groups = metricLines(main);
  const metricTable = (title: string, lines: MetricLine[]) => {
    if (lines.length === 0) return;
    heading(title);
    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [[t.metric, t.value, t.left, t.right, t.confidence, t.description]],
      body: lines.map((m) =>
        [m.name, m.value, m.left, m.right, m.confidence, m.description].map(text),
      ),
      columnStyles: {
        0: { cellWidth: 32, fontStyle: 'bold' },
        1: { cellWidth: 26 },
        2: { cellWidth: 17 },
        3: { cellWidth: 17 },
        4: { cellWidth: 24 },
      },
    });
    y = tableEnd() + 3;
  };
  metricTable(strings.metrics.primary, groups.primary);
  metricTable(strings.metrics.secondary, groups.secondary);

  // Before and after, with what to read with care.
  const changes = changeLines(snapshot);
  if (changes) {
    const earlier = snapshot.analyses.find((a) => a.id === snapshot.comparison?.baselineAnalysisId);
    heading(t.comparisonTitle);
    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [
        [
          t.metric,
          t.earlier(formatDisplayDate(earlier?.createdAt.slice(0, 10) ?? '')),
          t.later(formatDisplayDate(main.createdAt.slice(0, 10))),
          t.change,
        ],
      ],
      body: changes.map((c) => [c.name, c.earlier, c.later, c.change].map(text)),
      columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' } },
    });
    y = tableEnd() + 3;
    const caveats = caveatLines(snapshot);
    if (caveats.length > 0) {
      paragraph(strings.compare.caveatsTitle, 8.5, MUTED);
      for (const c of caveats) paragraph(`• ${c}`, 8.5);
    }
  }

  // Not measured: each once, with its reason, never as a blank value.
  const hidden = notMeasuredLines(main);
  if (hidden.length > 0) {
    heading(strings.metrics.notMeasured);
    for (const h of hidden) paragraph(h.reasons ? `${h.name}: ${h.reasons}` : h.name, 8.5);
  }

  if (snapshot.notes.length > 0) {
    heading(t.notes);
    for (const n of snapshot.notes) paragraph(`${noteDate(n.createdAt)}: ${n.text}`);
  }

  heading(t.howToRead);
  for (const item of t.howToReadItems) paragraph(`• ${item}`, 8.5);

  // The disclaimer, in a ruled box.
  y += 2;
  doc.setFont('Inter', 'bold');
  doc.setFontSize(8.5);
  const disclaimer = doc.splitTextToSize(t.disclaimer, CONTENT - 8) as string[];
  const boxHeight = disclaimer.length * 3.6 + 6;
  room(boxHeight);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.3);
  doc.rect(PAGE.margin, y, CONTENT, boxHeight, 'S');
  doc.setTextColor(...NAVY);
  doc.text(disclaimer, PAGE.margin + 4, y + 5);

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  const generated = formatDisplayDate(snapshot.generatedAt.slice(0, 10));
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, PAGE.height - 13, PAGE.width - PAGE.margin, PAGE.height - 13);
    doc.setFont('Inter', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      t.footer(main.algorithmVersion, generated, page, pages),
      PAGE.width / 2,
      PAGE.height - 9,
      {
        align: 'center',
      },
    );
  }
  return doc.output('blob');
}
