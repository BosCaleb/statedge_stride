import type { Calibration, Clip, Session } from '@stride/shared/api/sessions';
import { clipRoleSchema, modeSchema, surfaceSchema } from '@stride/shared/enums';
import { z } from 'zod';
import { guid, isoDate } from '../lib/db';

// Row shapes and mappers for sessions, calibrations and clips.

export const SESSION_COLUMNS =
  'id, session_date, place, surface, footwear, mode, notes, created_by, created_at';
const sessionRow = z.object({
  id: z.string(),
  session_date: z.date(),
  place: z.string().nullable(),
  surface: surfaceSchema.nullable(),
  footwear: z.string().nullable(),
  mode: modeSchema,
  notes: z.string().nullable(),
  created_by: z.string(),
  created_at: z.date(),
});

export function toSession(row: unknown): Session {
  const r = sessionRow.parse(row);
  return {
    id: guid(r.id),
    sessionDate: isoDate(r.session_date),
    place: r.place,
    surface: r.surface,
    footwear: r.footwear,
    mode: r.mode,
    notes: r.notes,
    createdBy: guid(r.created_by),
    createdAt: r.created_at.toISOString(),
  };
}

export const CALIBRATION_COLUMNS =
  'id, session_id, distance_m, marker_ax, marker_ay, marker_bx, marker_by, px_per_m, frame_width, frame_height, created_at';
const calibrationRow = z.object({
  id: z.string(),
  session_id: z.string(),
  distance_m: z.number(),
  marker_ax: z.number(),
  marker_ay: z.number(),
  marker_bx: z.number(),
  marker_by: z.number(),
  px_per_m: z.number(),
  frame_width: z.number().int(),
  frame_height: z.number().int(),
  created_at: z.date(),
});

export function toCalibration(row: unknown): Calibration {
  const r = calibrationRow.parse(row);
  return {
    id: guid(r.id),
    sessionId: guid(r.session_id),
    distanceM: r.distance_m,
    markerA: { x: r.marker_ax, y: r.marker_ay },
    markerB: { x: r.marker_bx, y: r.marker_by },
    pxPerM: r.px_per_m,
    frameWidth: r.frame_width,
    frameHeight: r.frame_height,
    createdAt: r.created_at.toISOString(),
  };
}

export const CLIP_COLUMNS =
  'id, session_id, athlete_id, role, calibration_id, device_model, declared_fps, detected_fps, width_px, height_px, frame_count, duration_sec, codec, direction, fingerprint, created_at';
const clipRow = z.object({
  id: z.string(),
  session_id: z.string(),
  athlete_id: z.string().nullable(),
  role: clipRoleSchema,
  calibration_id: z.string().nullable(),
  device_model: z.string().nullable(),
  declared_fps: z.number().int(),
  detected_fps: z.number().nullable(),
  width_px: z.number().int(),
  height_px: z.number().int(),
  frame_count: z.number().int(),
  duration_sec: z.number(),
  codec: z.string().nullable(),
  direction: z.union([z.literal(1), z.literal(-1)]).nullable(),
  fingerprint: z.string().nullable(),
  created_at: z.date(),
});

export function toClip(row: unknown): Clip {
  const r = clipRow.parse(row);
  return {
    id: guid(r.id),
    sessionId: guid(r.session_id),
    athleteId: guid(r.athlete_id),
    role: r.role,
    calibrationId: guid(r.calibration_id),
    deviceModel: r.device_model,
    declaredFps: r.declared_fps,
    detectedFps: r.detected_fps,
    widthPx: r.width_px,
    heightPx: r.height_px,
    frameCount: r.frame_count,
    durationSec: r.duration_sec,
    codec: r.codec,
    direction: r.direction,
    fingerprint: r.fingerprint,
    createdAt: r.created_at.toISOString(),
  };
}
