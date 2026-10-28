// Missing-sample handling: visibility masking and monotone cubic gap filling.

/** Copies `values`, setting samples whose visibility is below `minVisibility` to NaN. */
export function maskByVisibility(
  values: Float64Array,
  visibility: Float64Array,
  minVisibility: number,
): Float64Array {
  const out = Float64Array.from(values);
  for (let i = 0; i < out.length; i++) {
    if (!((visibility[i] ?? 0) >= minVisibility)) out[i] = NaN;
  }
  return out;
}

/** Fritsch-Butland derivative at a knot from its two neighbouring secants (keeps monotonicity). */
function knotDerivative(
  leftSlope: number,
  rightSlope: number,
  leftH: number,
  rightH: number,
): number {
  if (leftSlope * rightSlope <= 0) return 0;
  const w1 = 2 * rightH + leftH;
  const w2 = rightH + 2 * leftH;
  return (w1 + w2) / (w1 / leftSlope + w2 / rightSlope);
}

export interface FilledSeries {
  series: Float64Array;
  /** 1 where a sample was filled by interpolation. */
  filled: Uint8Array;
}

/**
 * Fills interior gaps of at most `maxGap` samples with monotone (piecewise cubic Hermite)
 * interpolation. Longer gaps, and missing samples at either end, stay NaN.
 */
export function fillGaps(series: Float64Array, maxGap: number): FilledSeries {
  const out = Float64Array.from(series);
  const filled = new Uint8Array(series.length);
  const n = series.length;
  const finite = (i: number) => i >= 0 && i < n && Number.isFinite(series[i] ?? NaN);
  let i = 0;
  while (i < n) {
    if (finite(i)) {
      i++;
      continue;
    }
    const gapStart = i;
    while (i < n && !finite(i)) i++;
    const a = gapStart - 1;
    const b = i;
    const gapLength = b - a - 1;
    if (a < 0 || b >= n || gapLength > maxGap) continue;
    const ya = series[a] ?? 0;
    const yb = series[b] ?? 0;
    const h = b - a;
    const slope = (yb - ya) / h;
    const da = finite(a - 1) ? knotDerivative(ya - (series[a - 1] ?? 0), slope, 1, h) : slope;
    const db = finite(b + 1) ? knotDerivative(slope, (series[b + 1] ?? 0) - yb, h, 1) : slope;
    for (let j = a + 1; j < b; j++) {
      const t = (j - a) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      out[j] =
        (2 * t3 - 3 * t2 + 1) * ya +
        (t3 - 2 * t2 + t) * h * da +
        (-2 * t3 + 3 * t2) * yb +
        (t3 - t2) * h * db;
      filled[j] = 1;
    }
  }
  return { series: out, filled };
}
