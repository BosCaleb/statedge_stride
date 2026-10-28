import { z } from 'zod';
import { consentEvidenceSchema, consentGiverSchema, consentPurposeSchema } from '../enums';
import {
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nameSchema,
  optionalText,
  pageOf,
  pageQuerySchema,
} from './common';

/** PUT /v1/athletes/{id}: create or update (last write wins). */
export const athletePutSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  birthYear: z.number().int().min(1940).max(2100),
  externalRef: optionalText(50),
});
export type AthletePut = z.infer<typeof athletePutSchema>;

export const consentSchema = z.object({
  id: idSchema,
  athleteId: idSchema,
  purpose: consentPurposeSchema,
  givenBy: consentGiverSchema,
  givenByName: z.string(),
  relationship: z.string().nullable(),
  evidence: consentEvidenceSchema,
  givenOn: isoDateSchema,
  recordedBy: idSchema,
  recordedAt: isoDateTimeSchema,
  withdrawnAt: isoDateTimeSchema.nullable(),
});
export type Consent = z.infer<typeof consentSchema>;

/** The active consent per purpose. */
export const consentSummarySchema = z.object({
  analysis: consentSchema.nullable(),
  sharing: consentSchema.nullable(),
  clip_storage: consentSchema.nullable(),
});
export type ConsentSummary = z.infer<typeof consentSummarySchema>;

export const athleteSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  birthYear: z.number().int(),
  externalRef: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  consents: consentSummarySchema,
});
export type Athlete = z.infer<typeof athleteSchema>;

export const athleteListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
});
export const athletePageSchema = pageOf(athleteSchema);

/** DELETE /v1/athletes/{id}: the body must repeat the athlete's full name. */
export const athleteDeleteSchema = z.object({ confirmName: z.string().trim().min(1).max(201) });

/**
 * PUT /v1/consents/{id}: immutable once written. `digital` evidence is reserved for a later
 * guardian sign-off link and is refused; `verbal` is allowed only for adults.
 */
export const consentPutSchema = z.object({
  athleteId: idSchema,
  purpose: consentPurposeSchema,
  givenBy: consentGiverSchema,
  givenByName: z.string().trim().min(1).max(200),
  relationship: optionalText(50),
  evidence: consentEvidenceSchema,
  givenOn: isoDateSchema,
});
export type ConsentPut = z.infer<typeof consentPutSchema>;

export const consentListSchema = z.object({ items: z.array(consentSchema) });
