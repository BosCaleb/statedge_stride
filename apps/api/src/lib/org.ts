import type { organisationSchema } from '@stride/shared/api/org';
import { orgTypeSchema } from '@stride/shared/enums';
import sql from 'mssql';
import { z } from 'zod';
import { guid, type Db } from './db';
import { notFound } from './errors';

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: orgTypeSchema,
  max_coaches: z.number().int(),
  clip_retention_days: z.number().int(),
  seats_used: z.number().int(),
});

/** The organisation and its seats used: active coaches plus pending, unexpired invites. */
export async function loadOrganisation(
  db: Db,
  orgId: string,
): Promise<{ organisation: z.input<typeof organisationSchema>; seatsUsed: number }> {
  const rows = await db.query<unknown>(
    `SELECT o.id, o.name, o.type, o.max_coaches, o.clip_retention_days,
       (SELECT COUNT(*) FROM stride.coaches c WHERE c.org_id = o.id AND c.status = 'active')
     + (SELECT COUNT(*) FROM stride.invites i
        WHERE i.org_id = o.id AND i.accepted_at IS NULL AND i.expires_at > SYSUTCDATETIME()) AS seats_used
     FROM stride.organisations o WHERE o.id = @org`,
    { org: [sql.UniqueIdentifier, orgId] },
  );
  if (rows[0] === undefined) throw notFound();
  const r = rowSchema.parse(rows[0]);
  return {
    organisation: {
      id: guid(r.id),
      name: r.name,
      type: r.type,
      maxCoaches: r.max_coaches,
      clipRetentionDays: r.clip_retention_days,
    },
    seatsUsed: r.seats_used,
  };
}
