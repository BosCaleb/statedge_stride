import { randomUUID } from 'node:crypto';
import { inviteCreatedSchema, meSchema, membersSchema } from '@stride/shared/api/org';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../lib/tokens';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';
import type { TestOrg } from '../test/db';

// Invites and seats: the sign-in and invite acceptance criteria.

let h: Harness;
let org: TestOrg;

beforeAll(async () => {
  h = await harness();
  org = await h.org('Invite School', 50);
});
afterAll(() => h.close());

async function invite(email: string, role: 'coach' | 'admin' = 'coach', target = org) {
  const res = await h.as(adminOf(target), 'createInvite', { body: { email, role } });
  expect(res.status, res.text).toBe(201);
  const created = inviteCreatedSchema.parse(res.json);
  const token = new URL(created.url).pathname.split('/').at(-1) ?? '';
  return { ...created, token };
}

const person = (email: string) => ({ oid: randomUUID(), email, name: 'New Person' });

describe('creating an invite', () => {
  it('returns a link with a 32-byte token once, and stores only its hash', async () => {
    const created = await invite('first.new@example.org');
    expect(created.url).toMatch(/^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/);
    const rows = await h.admin.withOrg(org.orgId, (db) =>
      db.query<{ n: number }>('SELECT COUNT(*) AS n FROM stride.invites WHERE token_hash = @hash', {
        hash: [sql.VarBinary(32), hashToken(created.token)],
      }),
    );
    expect(rows[0]?.n).toBe(1);
    const stored = await h.admin.withOrg(org.orgId, (db) =>
      db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM stride.invites WHERE CAST(token_hash AS VARCHAR(100)) LIKE '%' + @t + '%'",
        {
          t: [sql.VarChar(100), created.token],
        },
      ),
    );
    expect(stored[0]?.n).toBe(0);
  });

  it('is for administrators only', async () => {
    const res = await h.as(coachOf(org), 'createInvite', {
      body: { email: 'x@example.org', role: 'coach' },
    });
    expect(res.status).toBe(403);
  });

  it('refuses an email that already belongs to an active coach', async () => {
    const members = membersSchema.parse((await h.as(adminOf(org), 'listMembers')).json);
    const coachEmail = members.items.find((m) => m.role === 'coach')?.email ?? '';
    const res = await h.as(adminOf(org), 'createInvite', {
      body: { email: coachEmail.toUpperCase(), role: 'coach' },
    });
    expect(res.json).toMatchObject({ code: 'conflict' });
  });

  it('replaces a pending invite for the same email instead of using another seat', async () => {
    const before = membersSchema.parse((await h.as(adminOf(org), 'listMembers')).json).seatsUsed;
    const first = await invite('twice@example.org');
    const second = await invite('twice@example.org');
    const after = membersSchema.parse((await h.as(adminOf(org), 'listMembers')).json);
    expect(after.seatsUsed).toBe(before + 1);
    expect(after.pendingInvites.map((i) => i.id)).toContain(second.id);
    expect(after.pendingInvites.map((i) => i.id)).not.toContain(first.id);
    const old = await h.as(person('twice@example.org'), 'acceptInvite', {
      body: { token: first.token },
    });
    expect(old.status).toBe(404);
  });
});

describe('accepting an invite', () => {
  it('creates the coach in the right organisation with the right role', async () => {
    const created = await invite('Joiner@Example.org', 'admin');
    const joiner = person('joiner@example.org');
    const res = await h.as(joiner, 'acceptInvite', { body: { token: created.token } });
    expect(res.status, res.text).toBe(200);
    const me = meSchema.parse(res.json);
    expect(me.organisation.id).toBe(org.orgId);
    expect(me.coach).toMatchObject({
      role: 'admin',
      email: 'joiner@example.org',
      displayName: 'New Person',
    });
    const after = await h.as(joiner, 'me');
    expect(meSchema.parse(after.json).coach.id).toBe(me.coach.id);
    // Repeating the request (a lost response) returns the same coach.
    const again = await h.as(joiner, 'acceptInvite', { body: { token: created.token } });
    expect(meSchema.parse(again.json).coach.id).toBe(me.coach.id);
  });

  it('refuses a used invite for anyone else', async () => {
    const created = await invite('used.once@example.org');
    expect(
      (
        await h.as(person('used.once@example.org'), 'acceptInvite', {
          body: { token: created.token },
        })
      ).status,
    ).toBe(200);
    const second = await h.as(person('used.once@example.org'), 'acceptInvite', {
      body: { token: created.token },
    });
    expect(second.json).toMatchObject({ code: 'conflict' });
  });

  it('refuses an invite sent to a different email address', async () => {
    const created = await invite('intended@example.org');
    const res = await h.as(person('forwarded.to@example.org'), 'acceptInvite', {
      body: { token: created.token },
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: 'forbidden' });
  });

  it('refuses an expired invite and an unknown token alike', async () => {
    const created = await invite('late@example.org');
    await h.admin.withOrg(org.orgId, (db) =>
      db.execute(
        'UPDATE stride.invites SET expires_at = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE id = @id',
        {
          id: [sql.UniqueIdentifier, created.id],
        },
      ),
    );
    const expired = await h.as(person('late@example.org'), 'acceptInvite', {
      body: { token: created.token },
    });
    const unknown = await h.as(person('late@example.org'), 'acceptInvite', {
      body: { token: 'A'.repeat(43) },
    });
    expect(expired.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(expired.json).toMatchObject({ code: 'not_found' });
  });

  it('needs an email claim in the token', async () => {
    const created = await invite('no.claim@example.org');
    const res = await h.as({ oid: randomUUID() }, 'acceptInvite', {
      body: { token: created.token },
    });
    expect(res.status).toBe(403);
  });

  it('refuses someone who already belongs to another organisation', async () => {
    const other = await h.org('Other Club');
    const created = await invite('admin-elsewhere@example.org');
    const res = await h.as(
      { oid: other.adminOid, email: 'admin-elsewhere@example.org' },
      'acceptInvite',
      {
        body: { token: created.token },
      },
    );
    expect(res.json).toMatchObject({ code: 'conflict' });
  });
});

describe('seats', () => {
  it('a full organisation refuses a new invite', async () => {
    const small = await h.org('Small School', 2); // admin and coach: full
    const res = await h.as(adminOf(small), 'createInvite', {
      body: { email: 'one.more@example.org', role: 'coach' },
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: 'seat_limit' });
  });

  it('refuses acceptance when the seat limit was lowered after the invite', async () => {
    const shrinking = await h.org('Shrinking School', 3);
    const created = await invite('squeezed@example.org', 'coach', shrinking);
    await h.admin.withOrg(shrinking.orgId, (db) =>
      db.execute('UPDATE stride.organisations SET max_coaches = 2 WHERE id = @id', {
        id: [sql.UniqueIdentifier, shrinking.orgId],
      }),
    );
    const res = await h.as(person('squeezed@example.org'), 'acceptInvite', {
      body: { token: created.token },
    });
    expect(res.json).toMatchObject({ code: 'seat_limit' });
  });

  it('withdrawing a pending invite frees its seat', async () => {
    const tight = await h.org('Tight School', 3);
    const created = await invite('maybe@example.org', 'coach', tight);
    expect(
      (
        await h.as(adminOf(tight), 'createInvite', {
          body: { email: 'another@example.org', role: 'coach' },
        })
      ).status,
    ).toBe(422);
    expect(
      (await h.as(adminOf(tight), 'revokeInvite', { params: { id: created.id } })).status,
    ).toBe(204);
    expect(
      (await h.as(adminOf(tight), 'revokeInvite', { params: { id: created.id } })).status,
    ).toBe(404);
    expect(
      (
        await h.as(adminOf(tight), 'createInvite', {
          body: { email: 'another@example.org', role: 'coach' },
        })
      ).status,
    ).toBe(201);
  });

  it('a removed coach can be invited back and is reactivated', async () => {
    const club = await h.org('Return Club', 3);
    const members = membersSchema.parse((await h.as(adminOf(club), 'listMembers')).json);
    const coach = members.items.find((m) => m.role === 'coach');
    if (!coach) throw new Error('no coach');
    expect(
      (await h.as(adminOf(club), 'removeMember', { params: { coachId: coach.id } })).status,
    ).toBe(204);
    expect((await h.as(coachOf(club), 'me')).json).toMatchObject({ code: 'forbidden' });
    const created = await invite(coach.email, 'coach', club);
    const res = await h.as({ oid: club.coachOid, email: coach.email }, 'acceptInvite', {
      body: { token: created.token },
    });
    expect(meSchema.parse(res.json).coach.id).toBe(coach.id);
    expect((await h.as(coachOf(club), 'me')).status).toBe(200);
  });
});
