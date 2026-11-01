import type { InvocationContext, Timer } from '@azure/functions';
import {
  describeCounts,
  organisationIds,
  sweepOrganisation,
  type SweepCounts,
} from '../repo/retention';
import { services, type Services } from '../lib/services';

// retention-sweep: the daily timer function (registered in index.ts, at 00:00 UTC). One
// transaction per organisation, so that one organisation's failure leaves the others swept.
// The log carries counts and organisation ids only.

export interface SweepSummary {
  organisations: number;
  failed: number;
  totals: SweepCounts;
}

interface SweepLog {
  info(message: string): void;
  error(message: string): void;
}

export async function runRetentionSweep(s: Services, log: SweepLog): Promise<SweepSummary> {
  const now = s.now();
  const orgIds = await s.db.withOrgDirectory(organisationIds);
  const totals: SweepCounts = { sharedReports: 0, sharedFrames: 0, invites: 0, auditRows: 0 };
  let failed = 0;
  for (const orgId of orgIds) {
    try {
      const counts = await s.db.withOrg(orgId, (db) => sweepOrganisation(db, orgId, now));
      totals.sharedReports += counts.sharedReports;
      totals.sharedFrames += counts.sharedFrames;
      totals.invites += counts.invites;
      totals.auditRows += counts.auditRows;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      log.error(JSON.stringify({ event: 'retention.sweep.failed', orgId, error: message }));
    }
  }
  const summary = { organisations: orgIds.length, failed, totals };
  log.info(
    JSON.stringify({
      event: 'retention.sweep',
      organisations: summary.organisations,
      failed,
      counts: describeCounts(totals),
    }),
  );
  return summary;
}

export async function retentionSweep(_timer: Timer, context: InvocationContext): Promise<void> {
  const summary = await runRetentionSweep(services(), context);
  // A failed organisation fails the run, so that it shows as a failure in Application Insights.
  if (summary.failed > 0)
    throw new Error(`retention sweep failed for ${summary.failed} organisation(s)`);
}
