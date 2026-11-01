// Invites an administrator to an existing organisation and prints the one-time link: for when an
// organisation has lost its only admin (docs/runbook.md, "A coach is locked out"). Optionally
// removes the old admin's account first, which frees their seat. Run by StatEdge staff, like
// create-org: locally, or against Azure SQL after `az login` with ENVIRONMENT, SQL_SERVER and
// SQL_DATABASE set.
//
//   pnpm invite-admin --org "Ridge High School" --email new.head@ridge.example \
//     [--remove-email old.head@ridge.example] --web-origin https://stride.statedge.co.za

import { parseArgs } from 'node:util';
import sql from 'mssql';
import { z } from 'zod';
import { createDatabase } from '../apps/api/src/lib/db';
import { scriptDbSettings } from '../apps/api/src/migrate';
import { newToken } from '../apps/api/src/lib/tokens';
import { audit } from '../apps/api/src/repo/audit';
import {
  insertInvite,
  removeCoach,
  seatCounts,
  withdrawPendingInvites,
} from '../apps/api/src/repo/members';

const { values } = parseArgs({
  options: {
    org: { type: 'string' },
    email: { type: 'string' },
    'remove-email': { type: 'string' },
    'web-origin': { type: 'string', default: 'http://localhost:5173' },
  },
});

const args = z
  .object({
    org: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    removeEmail: z.email().max(320).optional(),
    webOrigin: z.url(),
  })
  .parse({
    org: values.org,
    email: values.email?.toLowerCase(),
    removeEmail: values['remove-email']?.toLowerCase(),
    webOrigin: values['web-origin'],
  });

const db = createDatabase(scriptDbSettings());
const { token, hash } = newToken();
try {
  // The organisation by its exact name (or id), read through the directory context.
  const matches = await db.withOrgDirectory((tx) =>
    tx.query<{ id: string; name: string }>(
      'SELECT id, name FROM stride.organisations WHERE name = @org OR CAST(id AS NVARCHAR(36)) = @org',
      { org: [sql.NVarChar(200), args.org] },
    ),
  );
  const [org, ...others] = matches;
  if (!org || others.length > 0)
    throw new Error(`expected one organisation named "${args.org}", found ${matches.length}`);
  const orgId = org.id.toLowerCase();

  const result = await db.withOrg(orgId, async (tx) => {
    let removed = false;
    if (args.removeEmail) {
      const rows = await tx.query<{ id: string }>(
        "SELECT id FROM stride.coaches WHERE email = @email AND status = 'active'",
        { email: [sql.NVarChar(320), args.removeEmail] },
      );
      const old = rows[0];
      if (!old) throw new Error(`no active coach with the email ${args.removeEmail}`);
      removed = (await removeCoach(tx, old.id)).removed;
      await audit(tx, {
        orgId,
        coachId: null,
        action: 'member.remove',
        targetType: 'coach',
        targetId: old.id,
        detail: 'by StatEdge',
      });
    }
    await withdrawPendingInvites(tx, orgId, args.email);
    const seats = await seatCounts(tx, orgId);
    if (seats.active + seats.pending >= seats.maxCoaches)
      throw new Error(
        `all ${seats.maxCoaches} seats are taken: remove a coach with --remove-email, or raise max_coaches first`,
      );
    const invite = await insertInvite(tx, {
      orgId,
      email: args.email,
      role: 'admin',
      hash,
      createdBy: null,
    });
    await audit(tx, {
      orgId,
      coachId: null,
      action: 'member.invite',
      targetType: 'invite',
      targetId: invite.id,
      detail: 'admin, by StatEdge',
    });
    return { removed, expiresAt: invite.expiresAt };
  });

  if (result.removed) console.log(`Removed ${args.removeEmail ?? ''} from ${org.name}.`);
  console.log(
    `Admin invite for ${args.email} to ${org.name}, valid until ${result.expiresAt.toISOString()} and shown only once:`,
  );
  console.log(`${args.webOrigin.replace(/\/$/, '')}/invite/${token}`);
} finally {
  await db.close();
}
