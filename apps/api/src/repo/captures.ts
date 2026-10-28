import type { Calibration, CalibrationPut, Clip, ClipPut } from '@stride/shared/api/sessions';
import sql from 'mssql';
import type { Db } from '../lib/db';
import { CALIBRATION_COLUMNS, CLIP_COLUMNS, toCalibration, toClip } from './sessions';

// Calibrations and clip metadata: immutable once written. A repeat of the same write is
// recognised (200); different content for an existing id is a conflict. What they point to (the
// session, the athlete, the calibration) must be in the organisation, which row-level security
// decides: a row of another organisation is simply not found.

export type WriteOutcome<T> =
  | { kind: 'created'; value: T }
  | { kind: 'same'; value: T }
  | { kind: 'different' }
  | { kind: 'missing'; what: 'session' | 'athlete' | 'calibration' | 'clip' | 'analysis' };

const byId = (id: string) => ({ id: [sql.UniqueIdentifier, id] as const });

/** REAL columns hold single precision, DECIMAL(6,3) three decimals: compare as stored. */
const sameReal = (a: number, b: number) => Math.fround(a) === Math.fround(b);
const sameDecimal3 = (a: number, b: number) => Math.round(a * 1000) === Math.round(b * 1000);

const SELECT_CALIBRATION = `SELECT ${CALIBRATION_COLUMNS} FROM stride.calibrations WHERE id = @id`;
const SESSION_EXISTS = 'SELECT 1 AS found FROM stride.sessions WHERE id = @id';
const INSERT_CALIBRATION = `INSERT INTO stride.calibrations
  (id, org_id, session_id, distance_m, marker_ax, marker_ay, marker_bx, marker_by, px_per_m, frame_width, frame_height)
  VALUES (@id, @org, @session, @distance, @ax, @ay, @bx, @by, @scale, @width, @height)`;

export async function getCalibration(db: Db, id: string): Promise<Calibration | null> {
  const rows = await db.query<unknown>(SELECT_CALIBRATION, byId(id));
  return rows[0] === undefined ? null : toCalibration(rows[0]);
}

function sameCalibration(stored: Calibration, put: CalibrationPut): boolean {
  return (
    stored.sessionId === put.sessionId &&
    sameDecimal3(stored.distanceM, put.distanceM) &&
    sameReal(stored.markerA.x, put.markerA.x) &&
    sameReal(stored.markerA.y, put.markerA.y) &&
    sameReal(stored.markerB.x, put.markerB.x) &&
    sameReal(stored.markerB.y, put.markerB.y) &&
    sameReal(stored.pxPerM, put.pxPerM) &&
    stored.frameWidth === put.frameWidth &&
    stored.frameHeight === put.frameHeight
  );
}

export async function putCalibration(
  db: Db,
  orgId: string,
  id: string,
  put: CalibrationPut,
): Promise<WriteOutcome<Calibration>> {
  const existing = await getCalibration(db, id);
  if (existing) {
    return sameCalibration(existing, put)
      ? { kind: 'same', value: existing }
      : { kind: 'different' };
  }
  if ((await db.query(SESSION_EXISTS, byId(put.sessionId))).length === 0)
    return { kind: 'missing', what: 'session' };
  await db.execute(INSERT_CALIBRATION, {
    id: [sql.UniqueIdentifier, id],
    org: [sql.UniqueIdentifier, orgId],
    session: [sql.UniqueIdentifier, put.sessionId],
    distance: [sql.Decimal(6, 3), put.distanceM],
    ax: [sql.Real, put.markerA.x],
    ay: [sql.Real, put.markerA.y],
    bx: [sql.Real, put.markerB.x],
    by: [sql.Real, put.markerB.y],
    scale: [sql.Real, put.pxPerM],
    width: [sql.Int, put.frameWidth],
    height: [sql.Int, put.frameHeight],
  });
  const created = await getCalibration(db, id);
  if (!created) throw new Error('calibration not visible after insert');
  return { kind: 'created', value: created };
}

const SELECT_CLIP = `SELECT ${CLIP_COLUMNS} FROM stride.clips WHERE id = @id`;
const ATHLETE_EXISTS = 'SELECT 1 AS found FROM stride.athletes WHERE id = @id';
const INSERT_CLIP = `INSERT INTO stride.clips
  (id, org_id, session_id, athlete_id, role, calibration_id, device_model, declared_fps, detected_fps,
   width_px, height_px, frame_count, duration_sec, codec, direction, fingerprint)
  VALUES (@id, @org, @session, @athlete, @role, @calibration, @model, @declared, @detected,
   @width, @height, @frames, @duration, @codec, @direction, @fingerprint)`;

export async function getClip(db: Db, id: string): Promise<Clip | null> {
  const rows = await db.query<unknown>(SELECT_CLIP, byId(id));
  return rows[0] === undefined ? null : toClip(rows[0]);
}

function sameClip(stored: Clip, put: ClipPut): boolean {
  const sameNullableReal = (a: number | null, b: number | null) =>
    a === null || b === null ? a === b : sameReal(a, b);
  return (
    stored.sessionId === put.sessionId &&
    stored.athleteId === put.athleteId &&
    stored.role === put.role &&
    stored.calibrationId === put.calibrationId &&
    stored.deviceModel === (put.deviceModel ?? null) &&
    stored.declaredFps === put.declaredFps &&
    sameNullableReal(stored.detectedFps, put.detectedFps) &&
    stored.widthPx === put.widthPx &&
    stored.heightPx === put.heightPx &&
    stored.frameCount === put.frameCount &&
    sameReal(stored.durationSec, put.durationSec) &&
    stored.codec === put.codec &&
    stored.direction === put.direction &&
    stored.fingerprint === put.fingerprint
  );
}

export async function putClip(
  db: Db,
  orgId: string,
  id: string,
  put: ClipPut,
): Promise<WriteOutcome<Clip>> {
  const existing = await getClip(db, id);
  if (existing) {
    return sameClip(existing, put) ? { kind: 'same', value: existing } : { kind: 'different' };
  }
  if ((await db.query(SESSION_EXISTS, byId(put.sessionId))).length === 0)
    return { kind: 'missing', what: 'session' };
  if (put.athleteId && (await db.query(ATHLETE_EXISTS, byId(put.athleteId))).length === 0)
    return { kind: 'missing', what: 'athlete' };
  if (put.calibrationId) {
    const calibration = await getCalibration(db, put.calibrationId);
    // A clip uses a calibration of its own session.
    if (!calibration || calibration.sessionId !== put.sessionId)
      return { kind: 'missing', what: 'calibration' };
  }
  await db.execute(INSERT_CLIP, {
    id: [sql.UniqueIdentifier, id],
    org: [sql.UniqueIdentifier, orgId],
    session: [sql.UniqueIdentifier, put.sessionId],
    athlete: [sql.UniqueIdentifier, put.athleteId],
    role: [sql.VarChar(12), put.role],
    calibration: [sql.UniqueIdentifier, put.calibrationId],
    model: [sql.NVarChar(100), put.deviceModel ?? null],
    declared: [sql.SmallInt, put.declaredFps],
    detected: [sql.Real, put.detectedFps],
    width: [sql.Int, put.widthPx],
    height: [sql.Int, put.heightPx],
    frames: [sql.Int, put.frameCount],
    duration: [sql.Real, put.durationSec],
    codec: [sql.VarChar(30), put.codec],
    direction: [sql.SmallInt, put.direction],
    fingerprint: [sql.Char(64), put.fingerprint],
  });
  const created = await getClip(db, id);
  if (!created) throw new Error('clip not visible after insert');
  return { kind: 'created', value: created };
}
