import type { Member } from '@stride/shared/api/org';
import { coachStatusSchema, roleSchema, type Role } from '@stride/shared/enums';
import { LIMITS } from '@stride/shared/limits';
import sql from 'mssql';
import { z } from 'zod';
import { guid, type Db } from '../lib/db';

// Coaches and invites. Seats used are active coaches plus pending, unexpired invites.

const memberRow = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string().nullable(),
  role: roleSchema,
  status: coachStatusSchema,
  created_at: z.date(),
  last_seen_at: z.date().nullable(),
  entra_oid: z.string(),
});

const inviteRow = z.object({
  id: z.string(),
  org_id: z.string(),
  email: z.string(),
  role: roleSchema,
  expires_at: z.date(),
  accepted_at: z.date().nullable(),
  created_at: z.date(),
});
export type InviteRow = z.infer<typeof inviteRow>;

export async function listMembers(
  db: Db,
  orgId: string,
): Promise<(Member & { entraOid: string })[]> {
  const rows = await db.query<unknown>(
    `SELECT id, email, display_name, role, status, created_at, last_seen_at, entra_oid
     FROM stride.coaches WHERE org_id = @org ORDER BY status, email`,
    { org: [sql.UniqueIdentifier, orgId] },
  );
  return rows.map((row) => {
    const r = memberRow.parse(row);
    return {
      id: guid(r.id),
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      lastSeenAt: r.last_seen_at?.toISOString() ?? null,
      entraOid: guid(r.entra_oid),
    };
  });
}

export async function pendingInvites(db: Db, orgId: string): Promise<InviteRow[]> {
  const rows = await db.query<unknown>(
    `SELECT id, org_id, email, role, expires_at, accepted_at, created_at FROM stride.invites
     WHERE org_id = @org AND accepted_at IS NULL AND expires_at > SYSUTCDATETIME()
     ORDER BY created_at DESC`,
    { org: [sql.UniqueIdentifier, orgId] },
  );
  return rows.map((r) => inviteRow.parse(r));
}

/** The invite readable in the current context (by token hash, or within the organisation). */
export async function inviteByHash(db: Db, hash: Buffer): Promise<InviteRow | null> {
  const rows = await db.query<unknown>(
    'SELECT id, org_id, email, role, expires_at, accepted_at, created_at FROM stride.invites WHERE token_hash = @hash',
    { hash: [sql.VarBinary(32), hash] },
  );
  return rows[0] === undefined ? null : inviteRow.parse(rows[0]);
}

export async function seatCounts(
  db: Db,
  orgId: string,
): Promise<{ maxCoaches: number; active: number; pending: number }> {
  const rows = await db.query<{ max_coaches: number; active: number; pending: number }>(
    `SELECT o.max_coaches,
       (SELECT COUNT(*) FROM stride.coaches c WHERE c.org_id = o.id AND c.status = 'active') AS active,
       (SELECT COUNT(*) FROM stride.invites i
        WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.expires_at > SYSUTCDATETIME()) AS pending
     FROM stride.organisations o WHERE o.id = @org`,
    { org: [sql.UniqueIdentifier, orgId] },
  );
  const r = rows[0];
  if (!r) throw new Error('organisation not visible in this context');
  return { maxCoaches: r.max_coaches, active: r.active, pending: r.pending };
}

/** Withdraws pending invites for this email, so that a new invite replaces them. */
export async function withdrawPendingInvites(
  db: Db,
  orgId: string,
  email: string,
): Promise<number> {
  return db.execute(
    'DELETE FROM stride.invites WHERE org_id = @org AND email = @email AND accepted_at IS NULL',
    {
      org: [sql.UniqueIdentifier, orgId],
      email: [sql.NVarChar(320), email],
    },
  );
}

export async function insertInvite(
  db: Db,
  input: { orgId: string; email: string; role: Role; hash: Buffer; createdBy: string | null },
): Promise<{ id: string; expiresAt: Date }> {
  const rows = await db.query<{ id: string; expires_at: Date }>(
    `INSERT INTO stride.invites (org_id, email, role, token_hash, expires_at, created_by)
     OUTPUT inserted.id, inserted.expires_at
     VALUES (@org, @email, @role, @hash, DATEADD(day, @days, SYSUTCDATETIME()), @by)`,
    {
      org: [sql.UniqueIdentifier, input.orgId],
      email: [sql.NVarChar(320), input.email],
      role: [sql.VarChar(10), input.role],
      hash: [sql.VarBinary(32), input.hash],
      days: [sql.Int, LIMITS.inviteExpiryDays],
      by: [sql.UniqueIdentifier, input.createdBy],
    },
  );
  const r = rows[0];
  if (!r) throw new Error('invite insert returned nothing');
  return { id: guid(r.id), expiresAt: r.expires_at };
}

export async function deletePendingInvite(db: Db, id: string): Promise<boolean> {
  const n = await db.execute('DELETE FROM stride.invites WHERE id = @id AND accepted_at IS NULL', {
    id: [sql.UniqueIdentifier, id],
  });
  return n > 0;
}

/** The coach record of this identity in the current organisation, if any. */
export async function coachByOid(
  db: Db,
  oid: string,
): Promise<{ id: string; status: 'active' | 'removed' } | null> {
  const rows = await db.query<{ id: string; status: 'active' | 'removed' }>(
    'SELECT id, status FROM stride.coaches WHERE entra_oid = @oid',
    { oid: [sql.UniqueIdentifier, oid] },
  );
  const r = rows[0];
  return r ? { id: guid(r.id), status: coachStatusSchema.parse(r.status) } : null;
}

export async function insertCoach(
  db: Db,
  input: { orgId: string; oid: string; email: string; displayName: string | null; role: Role },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO stride.coaches (org_id, entra_oid, email, display_name, role)
     OUTPUT inserted.id
     VALUES (@org, @oid, @email, @name, @role)`,
    {
      org: [sql.UniqueIdentifier, input.orgId],
      oid: [sql.UniqueIdentifier, input.oid],
      email: [sql.NVarChar(320), input.email],
      name: [sql.NVarChar(200), input.displayName],
      role: [sql.VarChar(10), input.role],
    },
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('coach insert returned nothing');
  return guid(id);
}

export async function reactivateCoach(
  db: Db,
  id: string,
  role: Role,
  displayName: string | null,
): Promise<void> {
  await db.execute(
    "UPDATE stride.coaches SET status = 'active', role = @role, display_name = COALESCE(@name, display_name) WHERE id = @id",
    {
      id: [sql.UniqueIdentifier, id],
      role: [sql.VarChar(10), role],
      name: [sql.NVarChar(200), displayName],
    },
  );
}

export async function markInviteAccepted(db: Db, id: string): Promise<void> {
  await db.execute(
    'UPDATE stride.invites SET accepted_at = SYSUTCDATETIME() WHERE id = @id AND accepted_at IS NULL',
    {
      id: [sql.UniqueIdentifier, id],
    },
  );
}

export async function removeCoach(
  db: Db,
  id: string,
): Promise<{ removed: boolean; oid: string | null }> {
  const rows = await db.query<{ entra_oid: string }>(
    "UPDATE stride.coaches SET status = 'removed' OUTPUT inserted.entra_oid WHERE id = @id AND status = 'active'",
    { id: [sql.UniqueIdentifier, id] },
  );
  const oid = rows[0]?.entra_oid;
  return { removed: oid !== undefined, oid: oid ? guid(oid) : null };
}

export async function setRetentionDays(db: Db, orgId: string, days: number): Promise<void> {
  await db.execute('UPDATE stride.organisations SET clip_retention_days = @days WHERE id = @org', {
    org: [sql.UniqueIdentifier, orgId],
    days: [sql.Int, days],
  });
}
