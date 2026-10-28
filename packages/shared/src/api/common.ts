import { z } from 'zod';
import { apiErrorCodeSchema } from '../enums';
import { LIMITS } from '../limits';

// Building blocks for the API schemas. Identifiers are GUIDs: client-generated UUID v4 for
// created resources, NEWSEQUENTIALID for coaches and invites. They are sent in lower case.

export const idSchema = z.guid().toLowerCase();
export const isoDateTimeSchema = z.iso.datetime();
export const isoDateSchema = z.iso.date();

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: apiErrorCodeSchema,
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Cursor pagination: default 25, maximum 100, opaque cursor. */
export const pageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageMax).default(LIMITS.pageDefault),
});

const trimmed = (max: number) => z.string().trim().min(1).max(max);
export const nameSchema = trimmed(100);
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Invite and share tokens: 32 random bytes in base64url without padding. */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const healthSchema = z.object({ status: z.literal('ok'), version: z.string() });
