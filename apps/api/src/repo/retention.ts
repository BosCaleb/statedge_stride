import { LIMITS } from '@stride/shared/limits';
import sql from 'mssql';
import { z } from 'zod';
import { guid, type Db } from '../lib/db';
import { audit } from './audit';

// The daily retention sweep (spec: Retention). Runs inside withOrg for one organisation at a
// time. shared_reports and shared_report_frames have no row-level security, so their queries
// name the organisation explicitly; invites and the audit log are filtered by row-level security
// as well as by the organisation named here. Queries are composed from constants only.

export interface SweepCounts {
  /** Public report copies that had expired or been revoked. */
  sharedReports: number;
  /** Their key frames. */
  sharedFrames: number;
  /** Invites past their expiry, accepted or not. */
  invites: number;
  /** Audit rows older than LIMITS.auditRetentionMonths. */
  auditRows: number;
}

const DEAD_SHARE = 's.org_id = @org AND (s.revoked_at IS NOT NULL OR s.expires_at <= @now)';
const DELETE_SHARED_FRAMES = `DELETE f FROM stride.shared_report_frames f
  JOIN stride.shared_reports s ON s.token_hash = f.token_hash
  WHERE ${DEAD_SHARE}`;
const DELETE_SHARED_REPORTS = `DELETE s FROM stride.shared_reports s WHERE ${DEAD_SHARE}`;
const DELETE_INVITES = 'DELETE FROM stride.invites WHERE org_id = @org AND expires_at <= @now';
const DELETE_AUDIT =
  'DELETE FROM stride.audit_log WHERE org_id = @org AND at < DATEADD(month, -@months, @now)';
const SELECT_ORGS = 'SELECT id FROM stride.organisations ORDER BY id';

/** Every organisation's id. Run inside withOrgDirectory. */
export async function organisationIds(db: Db): Promise<string[]> {
  const rows = await db.query<unknown>(SELECT_ORGS);
  return rows.map((r) => guid(z.object({ id: z.string() }).parse(r).id));
}

export const sweptAnything = (c: SweepCounts): boolean =>
  c.sharedReports + c.sharedFrames + c.invites + c.auditRows > 0;

/** "shares=1 share_frames=3 invites=0 audit=12": counts only, for the audit row and the log. */
export const describeCounts = (c: SweepCounts): string =>
  `shares=${c.sharedReports} share_frames=${c.sharedFrames} invites=${c.invites} audit=${c.auditRows}`;

/**
 * Deletes what has passed its retention period in one organisation and, when anything went,
 * writes one retention.sweep audit row with the counts. Run inside withOrg(orgId).
 */
export async function sweepOrganisation(db: Db, orgId: string, now: Date): Promise<SweepCounts> {
  const params = {
    org: [sql.UniqueIdentifier, orgId],
    now: [sql.DateTime2(0), now],
  } as const;
  const sharedFrames = await db.execute(DELETE_SHARED_FRAMES, params);
  const sharedReports = await db.execute(DELETE_SHARED_REPORTS, params);
  const invites = await db.execute(DELETE_INVITES, params);
  const auditRows = await db.execute(DELETE_AUDIT, {
    ...params,
    months: [sql.Int, LIMITS.auditRetentionMonths],
  });
  const counts = { sharedReports, sharedFrames, invites, auditRows };
  if (sweptAnything(counts)) {
    await audit(db, {
      orgId,
      coachId: null,
      action: 'retention.sweep',
      detail: describeCounts(counts),
    });
  }
  return counts;
}
