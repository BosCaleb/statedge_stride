import { z } from 'zod';

// Closed vocabularies shared by the analysis engine, the web app and the API.
// Each list is the single definition; zod enums and TypeScript types derive from it.

export const SIDES = ['left', 'right'] as const;
export const sideSchema = z.enum(SIDES);
export type Side = z.infer<typeof sideSchema>;

export const CONFIDENCES = ['high', 'medium', 'low', 'unavailable'] as const;
export const confidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof confidenceSchema>;

export const MODES = ['sprint', 'distance'] as const;
export const modeSchema = z.enum(MODES);
export type Mode = z.infer<typeof modeSchema>;

export const METRIC_IDS = [
  'cadence',
  'stride_frequency',
  'contact_time',
  'flight_time',
  'step_length',
  'stride_length',
  'speed',
  'overstride',
  'shin_angle_ic',
  'knee_flexion_ic',
  'hip_flexion_ic',
  'trunk_lean',
  'vertical_oscillation',
  'contact_asymmetry',
  'step_time_asymmetry',
  'arm_swing_range',
  'foot_angle_ic',
] as const;
export const metricIdSchema = z.enum(METRIC_IDS);
export type MetricId = z.infer<typeof metricIdSchema>;

export const GATE_STATUSES = ['pass', 'conditional', 'fail'] as const;
export const gateStatusSchema = z.enum(GATE_STATUSES);
export type GateStatus = z.infer<typeof gateStatusSchema>;

/** Statuses a stored analysis may have. A failed gate can never be saved. */
export const SAVED_GATE_STATUSES = ['pass', 'conditional'] as const;
export const savedGateStatusSchema = z.enum(SAVED_GATE_STATUSES);
export type SavedGateStatus = z.infer<typeof savedGateStatusSchema>;

export const CHECK_LEVELS = ['pass', 'warn', 'fail'] as const;
export const checkLevelSchema = z.enum(CHECK_LEVELS);
export type CheckLevel = z.infer<typeof checkLevelSchema>;

/** Clip-level checks run before pose estimation so that a hopeless clip fails fast. */
export const CLIP_CHECK_IDS = [
  'codec_decodable',
  'fps_ok',
  'timing_regular',
  'resolution_ok',
  'duration_ok',
  'calibration_present',
  'athlete_selected',
  'camera_stable',
] as const;

/** Result-level checks run after pose estimation and event detection. */
export const RESULT_CHECK_IDS = [
  'person_tracked',
  'body_visible',
  'athlete_size',
  'feet_visible',
  'steady_direction',
  'events_found',
  'events_alternate',
  'method_agreement',
  'timebase_plausible',
  'side_labels',
] as const;

export const GATE_CHECK_IDS = [...CLIP_CHECK_IDS, ...RESULT_CHECK_IDS] as const;
export const gateCheckIdSchema = z.enum(GATE_CHECK_IDS);
export type GateCheckId = z.infer<typeof gateCheckIdSchema>;

export const STANCE_AGREEMENTS = ['both', 'primary-only', 'secondary-only'] as const;
export const stanceAgreementSchema = z.enum(STANCE_AGREEMENTS);
export type StanceAgreement = z.infer<typeof stanceAgreementSchema>;

/** Analysis job stages, shown as Reading video, Finding the athlete, Detecting steps, Calculating. */
export const STAGES = ['reading', 'finding', 'detecting', 'calculating'] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

/** Runtime failure codes for an analysis job, mapped to coach-facing messages in strings.ts. */
export const FAIL_CODES = [
  'decode_failed',
  'unsupported_codec',
  'model_load_failed',
  'no_person',
  'tracking_lost',
  'timing_invalid',
  'out_of_memory',
  'cancelled',
  'unknown',
] as const;
export const failCodeSchema = z.enum(FAIL_CODES);
export type FailCode = z.infer<typeof failCodeSchema>;

/**
 * Why a confidence label was lowered or a metric is unavailable. The engine stores codes, not
 * sentences, so that the viewer, the PDF and a later Afrikaans translation all read the same
 * strings.ts entries. `gate:<check>` means a gate warning capped or hid the metric.
 */
export const BASE_REASON_CODES = [
  'few_cycles',
  'landmarks_unclear',
  'events_disagree',
  'low_frame_rate',
  'far_side',
  'side_labels_uncertain',
  'timing_sensitive',
  'planar_scale',
  'least_reliable_landmarks',
  'missing_input',
  'needs_calibration',
  'needs_both_sides',
  'experimental',
] as const;
export const baseReasonCodeSchema = z.enum(BASE_REASON_CODES);
export type BaseReasonCode = z.infer<typeof baseReasonCodeSchema>;

export const reasonCodeSchema = z.union([
  baseReasonCodeSchema,
  z.templateLiteral(['gate:', gateCheckIdSchema]),
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export const ROLES = ['admin', 'coach'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ORG_TYPES = ['school', 'club', 'practice'] as const;
export const orgTypeSchema = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof orgTypeSchema>;

export const COACH_STATUSES = ['active', 'removed'] as const;
export const coachStatusSchema = z.enum(COACH_STATUSES);
export type CoachStatus = z.infer<typeof coachStatusSchema>;

export const CONSENT_PURPOSES = ['analysis', 'clip_storage', 'sharing'] as const;
export const consentPurposeSchema = z.enum(CONSENT_PURPOSES);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const CONSENT_GIVERS = ['athlete', 'guardian'] as const;
export const consentGiverSchema = z.enum(CONSENT_GIVERS);
export type ConsentGiver = z.infer<typeof consentGiverSchema>;

/** `digital` is reserved for a later guardian sign-off link and is not accepted in the MVP. */
export const CONSENT_EVIDENCE = ['paper_form', 'digital', 'verbal'] as const;
export const consentEvidenceSchema = z.enum(CONSENT_EVIDENCE);
export type ConsentEvidence = z.infer<typeof consentEvidenceSchema>;

export const SURFACES = ['track', 'grass', 'treadmill', 'road', 'other'] as const;
export const surfaceSchema = z.enum(SURFACES);
export type Surface = z.infer<typeof surfaceSchema>;

export const CLIP_ROLES = ['calibration', 'run'] as const;
export const clipRoleSchema = z.enum(CLIP_ROLES);
export type ClipRole = z.infer<typeof clipRoleSchema>;

export const DEVICE_TIERS = ['A', 'B', 'C'] as const;
export const deviceTierSchema = z.enum(DEVICE_TIERS);
export type DeviceTier = z.infer<typeof deviceTierSchema>;

export const AUDIT_ACTIONS = [
  'athlete.create',
  'athlete.delete',
  'consent.record',
  'consent.withdraw',
  'analysis.save',
  'analysis.delete',
  'report.create',
  'share.create',
  'share.revoke',
  'export.athlete',
  'member.invite',
  'member.remove',
  'retention.sweep',
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const API_ERROR_CODES = [
  'unauthorised',
  'not_enrolled',
  'forbidden',
  'validation',
  'not_found',
  'conflict',
  'consent_required',
  'gate_failed',
  'seat_limit',
  'payload_too_large',
  'rate_limited',
  'internal',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
