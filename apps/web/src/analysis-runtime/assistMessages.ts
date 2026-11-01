import { z } from 'zod';

// Messages to and from the assist worker (assistWorker.ts), which finds people in frames for the
// athlete box suggestion and times the heavy pose model for the device check. Parsed on both
// sides, like the analysis worker's messages.

const bitmap = z.custom<ImageBitmap>(
  (v) => typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap,
);

export const toAssistSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('detect'),
    /** Sampled frames, scaled down; `scale` maps their pixels back to the full frame. */
    frames: z.array(z.object({ frame: z.number().int().nonnegative(), bitmap })),
    scale: z.number().positive(),
    minScore: z.number(),
  }),
  z.object({
    type: z.literal('timePose'),
    variant: z.enum(['full', 'heavy']),
    bitmaps: z.array(bitmap).min(2),
    maxCropPx: z.number().int().positive(),
  }),
]);
export type ToAssist = z.infer<typeof toAssistSchema>;

const box = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  score: z.number(),
});

export const fromAssistSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('detected'),
    samples: z.array(z.object({ frame: z.number().int(), boxes: z.array(box) })),
  }),
  z.object({
    type: z.literal('timed'),
    msPerFrame: z.number().nonnegative(),
    delegate: z.enum(['GPU', 'CPU']),
  }),
  z.object({ type: z.literal('failed'), detail: z.string() }),
]);
export type FromAssist = z.infer<typeof fromAssistSchema>;
