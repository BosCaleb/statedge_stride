import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices } from '../lib/services';
import { testConfig } from '../test/api';
import { adminDatabase, apiDatabase, createTestOrg, type TestOrg } from '../test/db';
import { runRetentionSweep } from './retentionSweep';

// The daily retention sweep, run as the API identity: expired and revoked share links with
// their frames, expired invites and audit rows older than 24 months go; everything else stays.
// One audit row per organisation records the counts, and the log carries no names.

const api = apiDatabase();
const admin = adminDatabase();
const NOW = new Date('2026-06-15T00:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
let a: TestOrg;
let b: TestOrg;
const hashes = { live: hash(), expired: hash(), revoked: hash(), otherOrg: hash() };

function hash(): Buffer {
  return createHash('sha256').update(randomUUID()).digest();
}

async function share(org: TestOrg, token: Buffer, expires: Date, revoked: Date | null) {
  await admin.withoutOrg(async (db) => {
    await db.execute(
      `INSERT INTO stride.shared_reports (token_hash, report_id, org_id, snapshot_json, expires_at, revoked_at)
       VALUES (@hash, @report, @org, N'{}', @expires, @revoked)`,
      {
        hash: [sql.VarBinary(32), token],
        report: [sql.UniqueIdentifier, randomUUID()],
        org: [sql.UniqueIdentifier, org.orgId],
        expires: [sql.DateTime2(0), expires],
        revoked: [sql.DateTime2(0), revoked],
      },
    );
    await db.execute(
      `INSERT INTO stride.shared_report_frames (token_hash, ordinal, label, jpeg)
       VALUES (@hash, 1, 'contact', 0xFFD8FFD9)`,
      { hash: [sql.VarBinary(32), token] },
    );
  });
}

async function invite(org: TestOrg, email: string, expires: Date, accepted: Date | null) {
  await admin.withOrg(org.orgId, (db) =>
    db.execute(
      `INSERT INTO stride.invites (org_id, email, role, token_hash, expires_at, accepted_at)
       VALUES (@org, @email, 'coach', @hash, @expires, @accepted)`,
      {
        org: [sql.UniqueIdentifier, org.orgId],
        email: [sql.NVarChar(320), email],
        hash: [sql.VarBinary(32), hash()],
        expires: [sql.DateTime2(0), expires],
        accepted: [sql.DateTime2(0), accepted],
      },
    ),
  );
}

async function auditRow(org: TestOrg, when: Date) {
  await admin.withOrg(org.orgId, (db) =>
    db.execute(
      "INSERT INTO stride.audit_log (org_id, action, detail, at) VALUES (@org, 'athlete.create', N'test', @at)",
      { org: [sql.UniqueIdentifier, org.orgId], at: [sql.DateTime2(0), when] },
    ),
  );
}

const sharesLeft = (org: TestOrg) =>
  admin.withoutOrg(async (db) => {
    const rows = await db.query<{ token_hash: Buffer; frames: number }>(
      `SELECT s.token_hash, (SELECT COUNT(*) FROM stride.shared_report_frames f WHERE f.token_hash = s.token_hash) AS frames
       FROM stride.shared_reports s WHERE s.org_id = @org`,
      { org: [sql.UniqueIdentifier, org.orgId] },
    );
    return rows.map((r) => ({ hash: r.token_hash.toString('hex'), frames: r.frames }));
  });

const invitesLeft = (org: TestOrg) =>
  admin.withOrg(org.orgId, async (db) =>
    (await db.query<{ email: string }>('SELECT email FROM stride.invites ORDER BY email')).map(
      (r) => r.email,
    ),
  );

const auditLeft = (org: TestOrg) =>
  admin.withOrg(org.orgId, (db) =>
    db.query<{ action: string; detail: string | null; coach_id: string | null }>(
      'SELECT action, detail, coach_id FROM stride.audit_log ORDER BY id',
    ),
  );

function sweeper() {
  const log: string[] = [];
  const s = createServices(testConfig(), { db: api, now: () => NOW });
  return {
    log,
    run: () => runRetentionSweep(s, { info: (m) => log.push(m), error: (m) => log.push(m) }),
  };
}

beforeAll(async () => {
  a = await createTestOrg(admin, 'Retention School A');
  b = await createTestOrg(admin, 'Retention Club B');
  await share(a, hashes.live, at(10), null);
  await share(a, hashes.expired, at(-1), null);
  await share(a, hashes.revoked, at(20), at(-2));
  await share(b, hashes.otherOrg, at(-5), null);
  await invite(a, 'pending@example.org', at(3), null);
  await invite(a, 'lapsed@example.org', at(-1), null);
  await invite(a, 'accepted@example.org', at(-30), at(-35));
  await auditRow(a, at(-25 * 31));
  await auditRow(a, at(-23 * 30));
  await auditRow(b, at(-26 * 31));
});

afterAll(async () => {
  await api.close();
  await admin.close();
});

describe('retention sweep', () => {
  it('deletes expired and revoked links with their frames, expired invites and old audit rows', async () => {
    const { run, log } = sweeper();
    const summary = await run();
    expect(summary.failed).toBe(0);
    expect(summary.organisations).toBeGreaterThanOrEqual(2);

    expect(await sharesLeft(a)).toEqual([{ hash: hashes.live.toString('hex'), frames: 1 }]);
    expect(await sharesLeft(b)).toEqual([]);
    expect(await invitesLeft(a)).toEqual(['pending@example.org']);

    const auditA = await auditLeft(a);
    expect(auditA.map((r) => r.action)).toEqual(['athlete.create', 'retention.sweep']);
    expect(auditA[1]).toEqual({
      action: 'retention.sweep',
      detail: 'shares=2 share_frames=2 invites=2 audit=1',
      coach_id: null,
    });
    expect((await auditLeft(b)).map((r) => r.detail)).toEqual([
      'shares=1 share_frames=1 invites=0 audit=1',
    ]);

    // The log has counts and ids, never a name or an email.
    expect(log.join('\n')).not.toMatch(/Retention School|Retention Club|@example\.org/);
    expect(log.at(-1)).toContain('"event":"retention.sweep"');
  });

  it('deletes nothing more and writes no audit row when nothing has expired', async () => {
    const before = await auditLeft(a);
    const { run } = sweeper();
    const summary = await run();
    expect(summary.failed).toBe(0);
    expect(await auditLeft(a)).toEqual(before);
    expect(await sharesLeft(a)).toHaveLength(1);
    expect(await invitesLeft(a)).toEqual(['pending@example.org']);
  });

  it('lists organisations only in the directory context, which can read nothing else', async () => {
    const seen = await api.withOrgDirectory(async (db) => ({
      orgs: await db.query<{ id: string }>('SELECT id FROM stride.organisations'),
      athletes: await db.query('SELECT id FROM stride.athletes'),
      coaches: await db.query('SELECT id FROM stride.coaches'),
      invites: await db.query('SELECT id FROM stride.invites'),
      audit: await db.query('SELECT id FROM stride.audit_log'),
    }));
    expect(seen.orgs.length).toBeGreaterThanOrEqual(2);
    expect(seen).toMatchObject({ athletes: [], coaches: [], invites: [], audit: [] });
  });

  it('cannot change or delete an organisation from the directory context', async () => {
    await expect(
      api.withOrgDirectory((db) =>
        db.execute("UPDATE stride.organisations SET name = N'Changed' WHERE id = @id", {
          id: [sql.UniqueIdentifier, a.orgId],
        }),
      ),
    ).rejects.toThrow(/block predicate/i);
    // An organisation with no coaches yet, so that no foreign key stops the delete first.
    const bare = randomUUID();
    await admin.withOrg(bare, (db) =>
      db.execute(
        "INSERT INTO stride.organisations (id, name, type) VALUES (@id, N'Bare', 'club')",
        {
          id: [sql.UniqueIdentifier, bare],
        },
      ),
    );
    await expect(
      api.withOrgDirectory((db) =>
        db.execute('DELETE FROM stride.organisations WHERE id = @id', {
          id: [sql.UniqueIdentifier, bare],
        }),
      ),
    ).rejects.toThrow(/block predicate/i);
    // Outside that context the list stays hidden, and the context does not outlive the call.
    const pool = await api.pool();
    const orgs = await pool
      .request()
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.organisations');
    expect(orgs.recordset[0]?.n).toBe(0);
  });
});
