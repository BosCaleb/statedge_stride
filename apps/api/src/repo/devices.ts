import type { DeviceCheckPost, DeviceProfile } from '@stride/shared/api/devices';
import { deviceTierSchema } from '@stride/shared/enums';
import sql from 'mssql';
import { z } from 'zod';
import type { Db } from '../lib/db';

// Device checks (per organisation) and the tested phone list (maintained by StatEdge).

/** Inserts once per id; a repeated send changes nothing. Returns true when inserted. */
export async function insertDeviceCheck(
  db: Db,
  orgId: string,
  check: DeviceCheckPost,
): Promise<{ created: boolean; createdAt: Date }> {
  const inserted = await db.execute(
    `IF NOT EXISTS (SELECT 1 FROM stride.device_checks WHERE id = @id)
     INSERT INTO stride.device_checks (id, org_id, device_model, os, browser, declared_fps, detected_fps, width_px, height_px, codec, timing_jitter, result, reason)
     VALUES (@id, @org, @model, @os, @browser, @declared, @detected, @width, @height, @codec, @jitter, @result, @reason)`,
    {
      id: [sql.UniqueIdentifier, check.id],
      org: [sql.UniqueIdentifier, orgId],
      model: [sql.NVarChar(100), check.deviceModel ?? null],
      os: [sql.NVarChar(50), check.os ?? null],
      browser: [sql.NVarChar(100), check.browser ?? null],
      declared: [sql.SmallInt, check.declaredFps],
      detected: [sql.Real, check.detectedFps],
      width: [sql.Int, check.widthPx],
      height: [sql.Int, check.heightPx],
      codec: [sql.VarChar(30), check.codec],
      jitter: [sql.Real, check.timingJitter],
      result: [sql.VarChar(12), check.result],
      reason: [sql.NVarChar(400), check.reason ?? null],
    },
  );
  const rows = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM stride.device_checks WHERE id = @id',
    {
      id: [sql.UniqueIdentifier, check.id],
    },
  );
  const createdAt = rows[0]?.created_at;
  if (!createdAt) throw new Error('device check not visible after insert');
  return { created: inserted > 0, createdAt };
}

const profileRow = z.object({
  model: z.string(),
  tier: deviceTierSchema,
  max_slowmo: z.string().nullable(),
  notes: z.string().nullable(),
  updated_at: z.date(),
});

export async function listDeviceProfiles(db: Db): Promise<DeviceProfile[]> {
  const rows = await db.query<unknown>(
    'SELECT model, tier, max_slowmo, notes, updated_at FROM stride.device_profiles ORDER BY tier, model',
  );
  return rows.map((row) => {
    const r = profileRow.parse(row);
    return {
      model: r.model,
      tier: r.tier,
      maxSlowmo: r.max_slowmo,
      notes: r.notes,
      updatedAt: r.updated_at.toISOString(),
    };
  });
}
