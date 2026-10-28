import { randomUUID } from 'node:crypto';
import { meSchema } from '@stride/shared/api/org';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoachDirectory } from '../lib/auth';
import { createServices, setServices } from '../lib/services';
import { callRoute, testConfig, testSigner } from '../test/api';
import { adminDatabase, apiDatabase, createTestOrg, type TestOrg } from '../test/db';
import './routes';

// GET /v1/me through the whole pipeline, against SQL Server as the API identity.

const api = apiDatabase();
const admin = adminDatabase();
let signer: Awaited<ReturnType<typeof testSigner>>;
let org: TestOrg;

beforeAll(async () => {
  const config = testConfig();
  signer = await testSigner(config);
  setServices(
    createServices(config, {
      db: api,
      verifier: signer.verifier,
      coaches: new CoachDirectory(api),
    }),
  );
  org = await createTestOrg(admin, 'Me Test School', 3);
});

afterAll(async () => {
  setServices(null);
  await api.close();
  await admin.close();
});

describe('GET /v1/me', () => {
  it('returns the coach, organisation, role and seats used', async () => {
    const res = await callRoute('me', { token: await signer.sign({ oid: org.adminOid }) });
    expect(res.status).toBe(200);
    const me = meSchema.parse(res.json);
    expect(me.coach).toMatchObject({ id: org.adminId, role: 'admin' });
    expect(me.organisation).toMatchObject({
      id: org.orgId,
      name: 'Me Test School',
      maxCoaches: 3,
      clipRetentionDays: 90,
    });
    expect(me.seatsUsed).toBe(2);
  });

  it('counts pending invites as used seats, but not expired or accepted ones', async () => {
    const invite = (days: number, accepted: boolean) =>
      admin.withOrg(org.orgId, (db) =>
        db.execute(
          `INSERT INTO stride.invites (org_id, email, role, token_hash, expires_at, accepted_at)
           VALUES (@org, N'x@example.org', 'coach', @hash, DATEADD(day, @days, SYSUTCDATETIME()), CASE WHEN @accepted = 1 THEN SYSUTCDATETIME() END)`,
          {
            org: [sql.UniqueIdentifier, org.orgId],
            hash: [sql.VarBinary(32), Buffer.from(randomUUID().replace(/-/g, ''), 'hex')],
            days: [sql.Int, days],
            accepted: [sql.Bit, accepted],
          },
        ),
      );
    await invite(7, false);
    await invite(-1, false);
    await invite(7, true);
    const res = await callRoute('me', { token: await signer.sign({ oid: org.coachOid }) });
    expect(meSchema.parse(res.json).seatsUsed).toBe(3);
  });

  it('records when the coach was last seen', async () => {
    const rows = await admin.withOrg(org.orgId, (db) =>
      db.query<{ last_seen_at: Date | null }>(
        'SELECT last_seen_at FROM stride.coaches WHERE id = @id',
        {
          id: [sql.UniqueIdentifier, org.adminId],
        },
      ),
    );
    expect(rows[0]?.last_seen_at).toBeInstanceOf(Date);
  });

  it('sends a valid token without a coach record to the invite flow', async () => {
    const res = await callRoute('me', {
      token: await signer.sign({ oid: randomUUID(), email: 'new@example.org' }),
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: 'not_enrolled' });
  });
});
