import interRegular from './fonts/Inter-Regular.ttf?inline';
import interSemiBold from './fonts/Inter-SemiBold.ttf?inline';
import oswaldBold from './fonts/Oswald-Bold.ttf?inline';

// The report PDF's fonts, inlined into the lazily loaded PDF chunk so that a PDF can be made
// offline (see fonts/README.md). Each is a data URL; jsPDF wants the base64 part.

const base64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

export const PDF_FONTS = [
  { file: 'Inter-Regular.ttf', family: 'Inter', style: 'normal', data: base64(interRegular) },
  { file: 'Inter-SemiBold.ttf', family: 'Inter', style: 'bold', data: base64(interSemiBold) },
  { file: 'Oswald-Bold.ttf', family: 'Oswald', style: 'bold', data: base64(oswaldBold) },
] as const;

/**
 * Characters the subset fonts can draw. Anything else in coach-typed text (notes, place names)
 * is replaced before it reaches the PDF, so that it never prints as an empty box.
 */
const DRAWABLE =
  /[^\u0020-\u007E\u00A0-\u00FF\u0131\u0152\u0153\u2013\u2014\u2018-\u201E\u2022\u2026\u2032\u2033\u20AC\u2122\u2212\n]/gu;

export function drawable(text: string): string {
  return text.replace(DRAWABLE, '?');
}
