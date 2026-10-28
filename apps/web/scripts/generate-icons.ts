// Renders the app icons (a placeholder mark until StatEdge supplies brand artwork): an orange
// chevron with a white one behind it on navy. Writes public/icons/*.png and favicon.svg.
//
//   pnpm --filter @stride/web exec tsx scripts/generate-icons.ts

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type Rgba = [number, number, number, number];
type Point = [number, number];
const NAVY: Rgba = [13, 28, 62, 255];
const ORANGE: Rgba = [244, 120, 32, 255];
const WHITE: Rgba = [255, 255, 255, 255];

/** The mark in a unit square: a white chevron, then the orange one in front. */
const chevron = (dx: number): Point[] => [
  [0.3 + dx, 0.22],
  [0.5 + dx, 0.22],
  [0.74 + dx, 0.5],
  [0.5 + dx, 0.78],
  [0.3 + dx, 0.78],
  [0.54 + dx, 0.5],
];
const SHAPES: [Point[], Rgba][] = [
  [chevron(-0.13), WHITE],
  [chevron(0.09), ORANGE],
];

function inside(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Point;
    const [xj, yj] = poly[j] as Point;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inRoundedSquare(x: number, y: number, radius: number): boolean {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** size in pixels; markScale shrinks the mark (maskable icons keep it in the safe zone). */
function render(size: number, options: { rounded: boolean; markScale: number }): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          let colour: Rgba | null = options.rounded && !inRoundedSquare(u, v, 0.18) ? null : NAVY;
          if (colour) {
            const mu = (u - 0.5) / options.markScale + 0.5;
            const mv = (v - 0.5) / options.markScale + 0.5;
            for (const [poly, c] of SHAPES) if (inside([mu, mv], poly)) colour = c;
          }
          if (colour) for (let k = 0; k < 4; k++) acc[k] = (acc[k] ?? 0) + (colour[k] ?? 0);
        }
      }
      const n = samples * samples;
      const o = (y * size + x) * 4;
      const alpha = (acc[3] ?? 0) / n;
      for (let k = 0; k < 3; k++)
        px[o + k] = alpha > 0 ? Math.round((acc[k] ?? 0) / n / (alpha / 255)) : 0;
      px[o + 3] = Math.round(alpha);
    }
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const dir = new URL('../public/icons/', import.meta.url);
const icons: [string, number, { rounded: boolean; markScale: number }][] = [
  ['icon-192.png', 192, { rounded: true, markScale: 0.8 }],
  ['icon-512.png', 512, { rounded: true, markScale: 0.8 }],
  ['icon-maskable-512.png', 512, { rounded: false, markScale: 0.58 }],
  ['apple-touch-icon-180.png', 180, { rounded: false, markScale: 0.72 }],
];
for (const [name, size, options] of icons) {
  writeFileSync(new URL(name, dir), png(size, render(size, options)));
  console.log(`wrote public/icons/${name}`);
}

const svgPoly = (poly: Point[]) =>
  poly.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(' ');
writeFileSync(
  new URL('../public/favicon.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#0D1C3E"/><g transform="translate(10 10) scale(0.8)"><polygon points="${svgPoly(chevron(-0.13))}" fill="#FFFFFF"/><polygon points="${svgPoly(chevron(0.09))}" fill="#F47820"/></g></svg>\n`,
);
console.log('wrote public/favicon.svg');
