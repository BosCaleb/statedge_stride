// Takes a shared report link down when the coach who made it cannot (docs/runbook.md, "A link
// must be revoked"). Deletes the public copy and its frames, exactly as the coach's Revoke does,
// and writes a share.revoke audit row. Needs only the link. Run by StatEdge staff, like
// create-org: locally, or against Azure SQL after `az login` with ENVIRONMENT, SQL_SERVER and
// SQL_DATABASE set.
//
//   pnpm revoke-link --url https://stride.statedge.co.za/r/<token>

import { parseArgs } from 'node:util';
import { tokenSchema } from '@stride/shared/api/common';
import sql from 'mssql';
import { z } from 'zod';
import { createDatabase, guid } from '../apps/api/src/lib/db';
import { scriptDbSettings } from '../apps/api/src/migrate';
import { hashToken } from '../apps/api/src/lib/tokens';
import { audit } from '../apps/api/src/repo/audit';
import { deleteShares } from '../apps/api/src/repo/reports';

const { values } = parseArgs({ options: { url: { type: 'string' } } });
const url = z.url().parse(values.url);
const token = tokenSchema.parse(new URL(url).pathname.split('/').filter(Boolean).at(-1));

const db = createDatabase(scriptDbSettings());
try {
  // shared_reports has no row-level security: it is found by the token's hash alone.
  const rows = await db.withoutOrg((tx) =>
    tx.query<{ org_id: string; report_id: string }>(
      'SELECT org_id, report_id FROM stride.shared_reports WHERE token_hash = @hash',
      { hash: [sql.VarBinary(32), hashToken(token)] },
    ),
  );
  const row = rows[0];
  if (!row) {
    console.log('No such link: it has expired and been swept, was replaced, or never existed.');
  } else {
    const orgId = guid(row.org_id);
    const reportId = guid(row.report_id);
    await db.withOrg(orgId, async (tx) => {
      await deleteShares(tx, orgId, reportId);
      await audit(tx, {
        orgId,
        coachId: null,
        action: 'share.revoke',
        targetType: 'report',
        targetId: reportId,
        detail: 'by StatEdge',
      });
    });
    console.log(
      `Revoked. Report ${reportId} in organisation ${orgId} no longer has a public link.`,
    );
  }
} finally {
  await db.close();
}
