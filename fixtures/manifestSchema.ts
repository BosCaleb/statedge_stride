import { z } from 'zod';

// The fixture manifest: every keypoint fixture, where it came from, how to run it, and the
// gate result and metric ranges it must produce.

export const fixtureSpecSchema = z.object({
  name: z.string(),
  file: z.string(),
  /** "synthetic" fixtures come from scripts/generate-fixtures.ts; "recorded" ones from the spike. */
  source: z.enum(['synthetic', 'recorded']),
  description: z.string(),
  /** For recorded fixtures: who owns the source clip and the date they agreed to its use. */
  consent: z.object({ owner: z.string(), agreedOn: z.string() }).optional(),
  mode: z.enum(['sprint', 'distance']),
  declaredFps: z.number().positive(),
  /** Scale of the calibration used for the run. */
  pxPerM: z.number().positive(),
  calibrated: z.boolean(),
  /** Camera shift measured for the clip, full-resolution pixels. */
  cameraShiftPx: z.number().nonnegative(),
  expected: z.object({
    /** Acceptable gate statuses. */
    gate: z.array(z.enum(['pass', 'conditional', 'fail'])).min(1),
    /** Checks that must fail. */
    failChecks: z.array(z.string()),
    /** Checks that must warn or fail. */
    warnOrFailChecks: z.array(z.string()).optional(),
    /** Inclusive [min, max] for metric values. */
    metrics: z.record(z.string(), z.tuple([z.number(), z.number()])),
  }),
});
export type FixtureSpec = z.infer<typeof fixtureSpecSchema>;

export const fixtureManifestSchema = z.object({
  version: z.literal(1),
  fixtures: z.array(fixtureSpecSchema),
});
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
