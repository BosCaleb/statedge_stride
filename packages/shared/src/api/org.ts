import { z } from 'zod';
import { auditActionSchema, coachStatusSchema, orgTypeSchema, roleSchema } from '../enums';
import { idSchema, isoDateTimeSchema, pageOf, tokenSchema } from './common';

export const coachSummarySchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
});

export const organisationSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: orgTypeSchema,
  maxCoaches: z.number().int(),
  clipRetentionDays: z.number().int(),
});

/** GET /v1/me */
export const meSchema = z.object({
  coach: coachSummarySchema,
  organisation: organisationSchema,
  /** Active coaches plus pending invites. */
  seatsUsed: z.number().int(),
});
export type Me = z.infer<typeof meSchema>;

/** PATCH /v1/org */
export const orgPatchSchema = z.object({ clipRetentionDays: z.number().int().min(1).max(365) });

export const memberSchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  status: coachStatusSchema,
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema.nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const pendingInviteSchema = z.object({
  id: idSchema,
  email: z.string(),
  role: roleSchema,
  expiresAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

/** GET /v1/org/members */
export const membersSchema = z.object({
  items: z.array(memberSchema),
  pendingInvites: z.array(pendingInviteSchema),
  maxCoaches: z.number().int(),
  seatsUsed: z.number().int(),
});
export type Members = z.infer<typeof membersSchema>;

/** POST /v1/org/invites */
export const inviteCreateSchema = z.object({ email: z.email().max(320), role: roleSchema });
export const inviteCreatedSchema = z.object({
  id: idSchema,
  /** Contains the token. Shown once: only its hash is stored. */
  url: z.url(),
  expiresAt: isoDateTimeSchema,
});

/** POST /v1/invites/accept */
export const inviteAcceptSchema = z.object({ token: tokenSchema });

export const auditEntrySchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  coachId: idSchema.nullable(),
  targetType: z.string().nullable(),
  targetId: idSchema.nullable(),
  detail: z.string().nullable(),
  at: isoDateTimeSchema,
});
export const auditPageSchema = pageOf(auditEntrySchema);
export type AuditEntry = z.infer<typeof auditEntrySchema>;
