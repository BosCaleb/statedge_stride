// Creates an organisation and prints a one-time invite link for its first admin. Run by
// StatEdge staff: locally against SQL Server in Docker, or against Azure SQL after `az login`
// with ENVIRONMENT, SQL_SERVER and SQL_DATABASE set.
//
//   pnpm create-org --name "Ridge High School" --type school --admin-email head.coach@ridge.example \
//     --seats 3 --web-origin https://stride.statedge.co.za

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { orgTypeSchema } from '@stride/shared/enums';
import { LIMITS } from '@stride/shared/limits';
import sql from 'mssql';
import { z } from 'zod';
import { createDatabase } from '../apps/api/src/lib/db';
import { scriptDbSettings } from '../apps/api/src/migrate';
import { newToken } from '../apps/api/src/lib/tokens';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    type: { type: 'string' },
    'admin-email': { type: 'string' },
    seats: { type: 'string', default: '2' },
    'web-origin': { type: 'string', default: 'http://localhost:5173' },
  },
});

const args = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: orgTypeSchema,
    adminEmail: z.email().max(320),
    seats: z.coerce.number().int().min(1).max(100),
    webOrigin: z.url(),
  })
  .parse({
    name: values.name,
    type: values.type,
    adminEmail: values['admin-email']?.toLowerCase(),
    seats: values.seats,
    webOrigin: values['web-origin'],
  });

const db = createDatabase(scriptDbSettings());
const orgId = randomUUID();
const { token, hash } = newToken();
try {
  await db.withOrg(orgId, async (tx) => {
    await tx.execute(
      'INSERT INTO stride.organisations (id, name, type, max_coaches) VALUES (@id, @name, @type, @seats)',
      {
        id: [sql.UniqueIdentifier, orgId],
        name: [sql.NVarChar(200), args.name],
        type: [sql.VarChar(10), args.type],
        seats: [sql.Int, args.seats],
      },
    );
    const invite = await tx.query<{ id: string }>(
      `INSERT INTO stride.invites (org_id, email, role, token_hash, expires_at)
       OUTPUT inserted.id
       VALUES (@org, @email, 'admin', @hash, DATEADD(day, @days, SYSUTCDATETIME()))`,
      {
        org: [sql.UniqueIdentifier, orgId],
        email: [sql.NVarChar(320), args.adminEmail],
        hash: [sql.VarBinary(32), hash],
        days: [sql.Int, LIMITS.inviteExpiryDays],
      },
    );
    await tx.execute(
      "INSERT INTO stride.audit_log (org_id, coach_id, action, target_type, target_id, detail) VALUES (@org, NULL, 'member.invite', 'invite', @invite, N'first admin, created by StatEdge')",
      { org: [sql.UniqueIdentifier, orgId], invite: [sql.UniqueIdentifier, invite[0]?.id ?? null] },
    );
  });
} finally {
  await db.close();
}

console.log(`Created organisation ${orgId} (${args.type}, ${args.seats} seats).`);
console.log(
  `Admin invite for ${args.adminEmail}, valid for ${LIMITS.inviteExpiryDays} days and shown only once:`,
);
console.log(`${args.webOrigin.replace(/\/$/, '')}/invite/${token}`);
