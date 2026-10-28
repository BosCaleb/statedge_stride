import type { AuditEntry } from '@stride/shared/api/org';
import { auditActionSchema, type AuditAction } from '@stride/shared/enums';
import sql from 'mssql';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { guid, type Db } from '../lib/db';

// The audit log: who did what, and when. Details hold ids and counts, never names.

export interface AuditInput {
  orgId: string;
  coachId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  detail?: string;
}

export async function audit(db: Db, entry: AuditInput): Promise<void> {
  await db.execute(
    `INSERT INTO stride.audit_log (org_id, coach_id, action, target_type, target_id, detail)
     VALUES (@org, @coach, @action, @type, @target, @detail)`,
    {
      org: [sql.UniqueIdentifier, entry.orgId],
      coach: [sql.UniqueIdentifier, entry.coachId],
      action: [sql.VarChar(40), entry.action],
      type: [sql.VarChar(30), entry.targetType ?? null],
      target: [sql.UniqueIdentifier, entry.targetId ?? null],
      detail: [sql.NVarChar(500), entry.detail ?? null],
    },
  );
}

const rowSchema = z.object({
  entry_id: z.string(),
  action: auditActionSchema,
  coach_id: z.string().nullable(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  detail: z.string().nullable(),
  at: z.date(),
});

/** Newest first. The cursor is the id of the last entry seen. */
export async function listAudit(
  db: Db,
  orgId: string,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  const before = decodeCursor(cursor, z.tuple([z.number().int().positive()]));
  const rows = await db.query<unknown>(
    // BIGINT ids come back as text; the alias must differ from id, or ORDER BY would sort text.
    `SELECT TOP (@take) CAST(id AS VARCHAR(20)) AS entry_id, action, coach_id, target_type, target_id, detail, at
     FROM stride.audit_log
     WHERE org_id = @org AND (@before IS NULL OR id < @before)
     ORDER BY id DESC`,
    {
      take: [sql.Int, limit + 1],
      org: [sql.UniqueIdentifier, orgId],
      before: [sql.BigInt, before?.[0] ?? null],
    },
  );
  const parsed = rows.map((r) => rowSchema.parse(r));
  const page = parsed.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.entry_id,
      action: r.action,
      coachId: guid(r.coach_id),
      targetType: r.target_type,
      targetId: guid(r.target_id),
      detail: r.detail,
      at: r.at.toISOString(),
    })),
    nextCursor: parsed.length > limit && last ? encodeCursor([Number(last.entry_id)]) : null,
  };
}
