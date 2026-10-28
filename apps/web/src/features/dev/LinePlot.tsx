import { useEffect, useRef } from 'react';

export interface PlotSeries {
  label: string;
  colour: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

export interface PlotBand {
  from: number;
  to: number;
  colour: string;
}

export interface PlotMarker {
  x: number;
  colour: string;
  label: string;
}

interface LinePlotProps {
  title: string;
  series: PlotSeries[];
  bands?: PlotBand[];
  markers?: PlotMarker[];
  /** Horizontal reference lines, for thresholds. */
  thresholds?: { y: number; colour: string; label: string }[];
  yRange?: [number, number];
  height?: number;
}

/** A small canvas line plot for the developer pages. Not used in the product UI. */
export function LinePlot({
  title,
  series,
  bands = [],
  markers = [],
  thresholds = [],
  yRange,
  height = 180,
}: LinePlotProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of series) {
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i] ?? NaN;
        const y = s.y[i] ?? NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    if (yRange) [yMin, yMax] = yRange;
    if (!Number.isFinite(xMin) || xMax === xMin) return;
    if (yMax === yMin) yMax = yMin + 1;
    const pad = { l: 40, r: 8, t: 18, b: 16 };
    const px = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * (width - pad.l - pad.r);
    const py = (y: number) =>
      height - pad.b - ((y - yMin) / (yMax - yMin)) * (height - pad.t - pad.b);
    for (const b of bands) {
      ctx.fillStyle = b.colour;
      ctx.fillRect(px(b.from), pad.t, Math.max(1, px(b.to) - px(b.from)), height - pad.t - pad.b);
    }
    ctx.strokeStyle = '#8888';
    ctx.strokeRect(pad.l, pad.t, width - pad.l - pad.r, height - pad.t - pad.b);
    ctx.fillStyle = 'currentColor';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.fillText(title, pad.l, 12);
    ctx.fillText(yMax.toPrecision(3), 2, pad.t + 8);
    ctx.fillText(yMin.toPrecision(3), 2, height - pad.b);
    for (const t of thresholds) {
      ctx.strokeStyle = t.colour;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, py(t.y));
      ctx.lineTo(width - pad.r, py(t.y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of series) {
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i] ?? NaN;
        const y = s.y[i] ?? NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          continue;
        }
        const cy = py(Math.min(yMax, Math.max(yMin, y)));
        if (pen) ctx.lineTo(px(x), cy);
        else ctx.moveTo(px(x), cy);
        pen = true;
      }
      ctx.stroke();
    }
    for (const m of markers) {
      ctx.strokeStyle = m.colour;
      ctx.beginPath();
      ctx.moveTo(px(m.x), pad.t);
      ctx.lineTo(px(m.x), height - pad.b);
      ctx.stroke();
      ctx.fillStyle = m.colour;
      ctx.fillText(m.label, px(m.x) + 2, pad.t + 10);
    }
  }, [series, bands, markers, thresholds, yRange, height, title]);

  return <canvas ref={ref} style={{ width: '100%', height }} aria-label={title} role="img" />;
}
