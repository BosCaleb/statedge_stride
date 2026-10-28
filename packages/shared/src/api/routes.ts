import { z } from 'zod';
import { LIMITS } from '../limits';
import {
  analysisPutSchema,
  analysisSchema,
  analysisSummarySchema,
  athleteAnalysesPageSchema,
  athleteAnalysesQuerySchema,
  notePutSchema,
  noteSchema,
} from './analyses';
import {
  athleteDeleteSchema,
  athleteListQuerySchema,
  athletePageSchema,
  athletePutSchema,
  athleteSchema,
  consentListSchema,
  consentPutSchema,
  consentSchema,
} from './athletes';
import { healthSchema, idSchema, pageQuerySchema, tokenSchema } from './common';
import { deviceCheckPostSchema, deviceCheckSchema, deviceProfileListSchema } from './devices';
import { athleteExportSchema } from './export';
import {
  auditPageSchema,
  inviteAcceptSchema,
  inviteCreatedSchema,
  inviteCreateSchema,
  meSchema,
  membersSchema,
  organisationSchema,
  orgPatchSchema,
} from './org';
import {
  frameOrdinalSchema,
  publicReportSchema,
  reportPutSchema,
  reportSchema,
  shareCreatedSchema,
  shareCreateSchema,
} from './reports';
import {
  calibrationPutSchema,
  calibrationSchema,
  clipPutSchema,
  clipSchema,
  sessionDetailSchema,
  sessionListQuerySchema,
  sessionPageSchema,
  sessionPutSchema,
  sessionSchema,
} from './sessions';

// The API surface, defined once. The API binds a handler to each entry, the web client derives
// its typed calls from it, and scripts/generate-openapi.ts turns it into openapi.json.

export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';

/**
 * none: public. token: a valid sign-in token, no coach record needed (accepting an invite).
 * coach: an enrolled, active coach of any role. admin: an enrolled admin.
 */
export type AuthLevel = 'none' | 'token' | 'coach' | 'admin';

export interface BinaryBody {
  kind: 'binary';
  contentType: 'application/octet-stream' | 'image/jpeg';
  maxBytes: number;
}

export interface RouteDef {
  method: HttpMethod;
  /** Relative to /api, with {name} path parameters. */
  path: `/v1/${string}`;
  auth: AuthLevel;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType | BinaryBody;
  /** The response body, a binary type, or null for 204 No Content. */
  response: z.ZodType | BinaryBody | null;
  /**
   * once: an idempotent create, 201 on the first write and 200 when the same request is
   * repeated. always: every call creates something new and answers 201.
   */
  creates?: 'once' | 'always';
  /** Public responses that may be cached, in seconds. Everything else is no-store. */
  maxAgeSeconds?: number;
}

const binary = (contentType: BinaryBody['contentType'], maxBytes: number) =>
  ({ kind: 'binary', contentType, maxBytes }) as const;

const id = z.object({ id: idSchema });
const writeReceipt = z.object({ bytes: z.number().int() });

export const ROUTES = {
  health: {
    method: 'GET',
    path: '/v1/health',
    auth: 'none',
    summary: 'Status and build version. Does not touch the database',
    response: healthSchema,
  },
  me: {
    method: 'GET',
    path: '/v1/me',
    auth: 'coach',
    summary: 'The signed-in coach, organisation, role, seats used and retention setting',
    response: meSchema,
  },
  patchOrg: {
    method: 'PATCH',
    path: '/v1/org',
    auth: 'admin',
    summary: 'Update organisation settings (retention days)',
    body: orgPatchSchema,
    response: organisationSchema,
  },
  listMembers: {
    method: 'GET',
    path: '/v1/org/members',
    auth: 'admin',
    summary: 'List coaches and pending invites',
    response: membersSchema,
  },
  removeMember: {
    method: 'DELETE',
    path: '/v1/org/members/{coachId}',
    auth: 'admin',
    summary: 'Remove a coach and free a seat. Their analyses stay with the organisation',
    params: z.object({ coachId: idSchema }),
    response: null,
  },
  createInvite: {
    method: 'POST',
    path: '/v1/org/invites',
    auth: 'admin',
    summary: 'Create an invite. Returns a link containing the token, shown once',
    body: inviteCreateSchema,
    response: inviteCreatedSchema,
    creates: 'always',
  },
  revokeInvite: {
    method: 'DELETE',
    path: '/v1/org/invites/{id}',
    auth: 'admin',
    summary: 'Withdraw a pending invite and free its seat',
    params: id,
    response: null,
  },
  listAudit: {
    method: 'GET',
    path: '/v1/org/audit',
    auth: 'admin',
    summary: 'The audit log, newest first',
    query: pageQuerySchema,
    response: auditPageSchema,
  },
  acceptInvite: {
    method: 'POST',
    path: '/v1/invites/accept',
    auth: 'token',
    summary: 'Accept an invite and create the coach record',
    body: inviteAcceptSchema,
    response: meSchema,
  },
  listAthletes: {
    method: 'GET',
    path: '/v1/athletes',
    auth: 'coach',
    summary: 'List athletes by name',
    query: athleteListQuerySchema,
    response: athletePageSchema,
  },
  putAthlete: {
    method: 'PUT',
    path: '/v1/athletes/{id}',
    auth: 'coach',
    summary: 'Create or update an athlete',
    params: id,
    body: athletePutSchema,
    response: athleteSchema,
    creates: 'once',
  },
  getAthlete: {
    method: 'GET',
    path: '/v1/athletes/{id}',
    auth: 'coach',
    summary: 'One athlete with consent summary',
    params: id,
    response: athleteSchema,
  },
  deleteAthlete: {
    method: 'DELETE',
    path: '/v1/athletes/{id}',
    auth: 'admin',
    summary: "Delete everything held for the athlete. The body repeats the athlete's name",
    params: id,
    body: athleteDeleteSchema,
    response: null,
  },
  listConsents: {
    method: 'GET',
    path: '/v1/athletes/{id}/consents',
    auth: 'coach',
    summary: 'Consent history',
    params: id,
    response: consentListSchema,
  },
  putConsent: {
    method: 'PUT',
    path: '/v1/consents/{id}',
    auth: 'coach',
    summary: 'Record a consent. Immutable once written',
    params: id,
    body: consentPutSchema,
    response: consentSchema,
    creates: 'once',
  },
  withdrawConsent: {
    method: 'POST',
    path: '/v1/consents/{id}/withdraw',
    auth: 'coach',
    summary: 'Withdraw a consent',
    params: id,
    response: consentSchema,
  },
  listSessions: {
    method: 'GET',
    path: '/v1/sessions',
    auth: 'coach',
    summary: 'List sessions, newest first',
    query: sessionListQuerySchema,
    response: sessionPageSchema,
  },
  putSession: {
    method: 'PUT',
    path: '/v1/sessions/{id}',
    auth: 'coach',
    summary: 'Create or update a session',
    params: id,
    body: sessionPutSchema,
    response: sessionSchema,
    creates: 'once',
  },
  getSession: {
    method: 'GET',
    path: '/v1/sessions/{id}',
    auth: 'coach',
    summary: 'Session with calibrations, clips and analysis summaries',
    params: id,
    response: sessionDetailSchema,
  },
  putCalibration: {
    method: 'PUT',
    path: '/v1/calibrations/{id}',
    auth: 'coach',
    summary: 'Store marker taps and scale. Immutable once written',
    params: id,
    body: calibrationPutSchema,
    response: calibrationSchema,
    creates: 'once',
  },
  putClip: {
    method: 'PUT',
    path: '/v1/clips/{id}',
    auth: 'coach',
    summary: 'Store clip metadata. Immutable once written',
    params: id,
    body: clipPutSchema,
    response: clipSchema,
    creates: 'once',
  },
  getClip: {
    method: 'GET',
    path: '/v1/clips/{id}',
    auth: 'coach',
    summary: 'Clip metadata',
    params: id,
    response: clipSchema,
  },
  putAnalysis: {
    method: 'PUT',
    path: '/v1/analyses/{id}',
    auth: 'coach',
    summary:
      'Store a result. The server re-validates it, enforces consent and gate status, and writes metric rows',
    params: id,
    body: analysisPutSchema,
    response: analysisSummarySchema,
    creates: 'once',
  },
  putKeypoints: {
    method: 'PUT',
    path: '/v1/analyses/{id}/keypoints',
    auth: 'coach',
    summary: 'Upload the gzip-compressed SKP1 keypoint file. Immutable once written',
    params: id,
    body: binary('application/octet-stream', LIMITS.keypointsCompressedBytes),
    response: writeReceipt,
    creates: 'once',
  },
  getAnalysis: {
    method: 'GET',
    path: '/v1/analyses/{id}',
    auth: 'coach',
    summary: 'Result JSON and notes',
    params: id,
    response: analysisSchema,
  },
  getKeypoints: {
    method: 'GET',
    path: '/v1/analyses/{id}/keypoints',
    auth: 'coach',
    summary: 'Download the gzip-compressed SKP1 keypoint file',
    params: id,
    response: binary('application/octet-stream', LIMITS.keypointsCompressedBytes),
  },
  athleteAnalyses: {
    method: 'GET',
    path: '/v1/athletes/{id}/analyses',
    auth: 'coach',
    summary: 'Analysis history with metric rows, for trends',
    params: id,
    query: athleteAnalysesQuerySchema,
    response: athleteAnalysesPageSchema,
  },
  deleteAnalysis: {
    method: 'DELETE',
    path: '/v1/analyses/{id}',
    auth: 'coach',
    summary: 'Delete one analysis with its metrics and notes',
    params: id,
    response: null,
  },
  putNote: {
    method: 'PUT',
    path: '/v1/notes/{id}',
    auth: 'coach',
    summary: 'Create or update a coach note',
    params: id,
    body: notePutSchema,
    response: noteSchema,
    creates: 'once',
  },
  deleteNote: {
    method: 'DELETE',
    path: '/v1/notes/{id}',
    auth: 'coach',
    summary: 'Delete a coach note',
    params: id,
    response: null,
  },
  putReport: {
    method: 'PUT',
    path: '/v1/reports/{id}',
    auth: 'coach',
    summary: 'Store a report snapshot',
    params: id,
    body: reportPutSchema,
    response: reportSchema,
    creates: 'once',
  },
  putReportFrame: {
    method: 'PUT',
    path: '/v1/reports/{id}/frames/{ordinal}',
    auth: 'coach',
    summary: 'Upload a key-frame JPEG (at most five per report)',
    params: z.object({ id: idSchema, ordinal: frameOrdinalSchema }),
    body: binary('image/jpeg', LIMITS.frameJpegBytes),
    response: writeReceipt,
    creates: 'once',
  },
  getReport: {
    method: 'GET',
    path: '/v1/reports/{id}',
    auth: 'coach',
    summary: 'Report snapshot',
    params: id,
    response: reportSchema,
  },
  createShare: {
    method: 'POST',
    path: '/v1/reports/{id}/share',
    auth: 'coach',
    summary: 'Create a public copy. Needs sharing consent. Returns the link once',
    params: id,
    body: shareCreateSchema,
    response: shareCreatedSchema,
    creates: 'always',
  },
  revokeShare: {
    method: 'DELETE',
    path: '/v1/reports/{id}/share',
    auth: 'coach',
    summary: 'Revoke the public copy',
    params: id,
    response: null,
  },
  publicReport: {
    method: 'GET',
    path: '/v1/public/reports/{token}',
    auth: 'none',
    summary: 'Public report snapshot',
    params: z.object({ token: tokenSchema }),
    response: publicReportSchema,
  },
  publicReportFrame: {
    method: 'GET',
    path: '/v1/public/reports/{token}/frames/{ordinal}',
    auth: 'none',
    summary: 'Public key-frame image',
    params: z.object({ token: tokenSchema, ordinal: frameOrdinalSchema }),
    response: binary('image/jpeg', LIMITS.frameJpegBytes),
  },
  postDeviceCheck: {
    method: 'POST',
    path: '/v1/device-checks',
    auth: 'coach',
    summary: 'Record a device check',
    body: deviceCheckPostSchema,
    response: deviceCheckSchema,
    creates: 'once',
  },
  deviceProfiles: {
    method: 'GET',
    path: '/v1/device-profiles',
    auth: 'none',
    summary: 'The tested compatible-phone list',
    response: deviceProfileListSchema,
    maxAgeSeconds: 3600,
  },
  exportAthlete: {
    method: 'GET',
    path: '/v1/athletes/{id}/export',
    auth: 'admin',
    summary: 'Everything held about one athlete as JSON, for a data access request',
    params: id,
    response: athleteExportSchema,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof ROUTES;

export function routeEntries(): [RouteName, RouteDef][] {
  return Object.entries(ROUTES) as [RouteName, RouteDef][];
}

export function isBinary(value: RouteDef['body'] | RouteDef['response']): value is BinaryBody {
  return value !== undefined && value !== null && !(value instanceof z.ZodType);
}
