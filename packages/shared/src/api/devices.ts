import { z } from 'zod';
import { deviceTierSchema, gateStatusSchema } from '../enums';
import { idSchema, isoDateTimeSchema, optionalText } from './common';

/**
 * POST /v1/device-checks: records a device check. The id is generated on the phone, so a
 * repeated send (from the outbox) stores one row.
 */
export const deviceCheckPostSchema = z.object({
  id: idSchema,
  deviceModel: optionalText(100),
  os: optionalText(50),
  browser: optionalText(100),
  declaredFps: z.number().int().min(1).max(1000).nullable(),
  detectedFps: z.number().finite().positive().max(2000).nullable(),
  widthPx: z.number().int().min(16).max(8192).nullable(),
  heightPx: z.number().int().min(16).max(8192).nullable(),
  codec: z.string().max(30).nullable(),
  /** Coefficient of variation of the frame intervals. */
  timingJitter: z.number().finite().nonnegative().max(100).nullable(),
  result: gateStatusSchema,
  /** The reason codes behind a conditional or failed result, comma separated. */
  reason: optionalText(400),
});
export type DeviceCheckPost = z.infer<typeof deviceCheckPostSchema>;

export const deviceCheckSchema = z.object({ id: idSchema, createdAt: isoDateTimeSchema });

export const deviceProfileSchema = z.object({
  model: z.string(),
  tier: deviceTierSchema,
  maxSlowmo: z.string().nullable(),
  notes: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type DeviceProfile = z.infer<typeof deviceProfileSchema>;

/** GET /v1/device-profiles: the tested compatible-phone list, maintained by StatEdge. */
export const deviceProfileListSchema = z.object({ items: z.array(deviceProfileSchema) });
