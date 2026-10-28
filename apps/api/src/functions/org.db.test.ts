import { auditPageSchema, membersSchema, organisationSchema } from '@stride/shared/api/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// Organisation settings, members and the audit log.

let h: Harness;
let org: TestOrg;

beforeAll(async () => {
  h = await harness();
  org = await h.org('Settings School', 10);
});
afterAll(() => h.close());

describe('organisation settings', () => {
  it('lets an administrator change the clip retention period', async () => {
    const res = await h.as(adminOf(org), 'patchOrg', { body: { clipRetentionDays: 30 } });
    expect(res.status).toBe(200);
    expect(organisationSchema.parse(res.json).clipRetentionDays).toBe(30);
    expect((await h.as(adminOf(org), 'me')).json).toMatchObject({
      organisation: { clipRetentionDays: 30 },
    });
  });

  it('keeps retention between 1 and 365 days, and from coaches', async () => {
    expect((await h.as(adminOf(org), 'patchOrg', { body: { clipRetentionDays: 0 } })).status).toBe(
      400,
    );
    expect(
      (await h.as(adminOf(org), 'patchOrg', { body: { clipRetentionDays: 366 } })).status,
    ).toBe(400);
    expect((await h.as(coachOf(org), 'patchOrg', { body: { clipRetentionDays: 60 } })).status).toBe(
      403,
    );
  });
});

describe('members', () => {
  it('lists coaches, pending invites and seats', async () => {
    await h.as(adminOf(org), 'createInvite', {
      body: { email: 'pending@example.org', role: 'coach' },
    });
    const members = membersSchema.parse((await h.as(adminOf(org), 'listMembers')).json);
    expect(members.items.map((m) => m.role).sort()).toEqual(['admin', 'coach']);
    expect(members.pendingInvites.map((i) => i.email)).toEqual(['pending@example.org']);
    expect(members).toMatchObject({ maxCoaches: 10, seatsUsed: 3 });
  });

  it('removes a coach, who then loses access at once, and frees the seat', async () => {
    const club = await h.org('Removal Club', 3);
    expect((await h.as(coachOf(club), 'me')).status).toBe(200);
    const before = membersSchema.parse((await h.as(adminOf(club), 'listMembers')).json);
    expect(
      (await h.as(adminOf(club), 'removeMember', { params: { coachId: club.coachId } })).status,
    ).toBe(204);
    expect((await h.as(coachOf(club), 'me')).json).toMatchObject({ code: 'forbidden' });
    const after = membersSchema.parse((await h.as(adminOf(club), 'listMembers')).json);
    expect(after.seatsUsed).toBe(before.seatsUsed - 1);
    expect(after.items.find((m) => m.id === club.coachId)?.status).toBe('removed');
    expect(
      (await h.as(adminOf(club), 'removeMember', { params: { coachId: club.coachId } })).status,
    ).toBe(404);
  });

  it('does not let an administrator remove themselves', async () => {
    const res = await h.as(adminOf(org), 'removeMember', { params: { coachId: org.adminId } });
    expect(res.status).toBe(403);
  });
});

describe('the organisation boundary', () => {
  it("cannot remove another organisation's coach or withdraw its invites", async () => {
    const other = await h.org('Neighbour Club');
    const res = await h.as(adminOf(other), 'createInvite', {
      body: { email: 'theirs@example.org', role: 'coach' },
    });
    const inviteId = (res.json as { id: string }).id;
    expect(
      (await h.as(adminOf(org), 'removeMember', { params: { coachId: other.coachId } })).status,
    ).toBe(404);
    expect((await h.as(adminOf(org), 'revokeInvite', { params: { id: inviteId } })).status).toBe(
      404,
    );
    expect((await h.as(coachOf(other), 'me')).status).toBe(200);
    const members = membersSchema.parse((await h.as(adminOf(org), 'listMembers')).json);
    expect(members.items.some((m) => m.id === other.coachId)).toBe(false);
    expect(members.pendingInvites.some((i) => i.id === inviteId)).toBe(false);
  });
});

describe('audit log', () => {
  it('records invites and removals, newest first, in pages, for administrators', async () => {
    const club = await h.org('Audit Club', 6);
    for (const email of ['a1@example.org', 'a2@example.org', 'a3@example.org']) {
      await h.as(adminOf(club), 'createInvite', { body: { email, role: 'coach' } });
    }
    await h.as(adminOf(club), 'removeMember', { params: { coachId: club.coachId } });
    const first = auditPageSchema.parse(
      (await h.as(adminOf(club), 'listAudit', { query: { limit: '3' } })).json,
    );
    expect(first.items.map((e) => e.action)).toEqual([
      'member.remove',
      'member.invite',
      'member.invite',
    ]);
    expect(first.items.every((e) => e.coachId === club.adminId)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = auditPageSchema.parse(
      (
        await h.as(adminOf(club), 'listAudit', {
          query: { limit: '3', cursor: first.nextCursor ?? '' },
        })
      ).json,
    );
    expect(second.items.map((e) => e.action)).toEqual(['member.invite']);
    expect(second.nextCursor).toBeNull();
    expect((await h.as(coachOf(org), 'listAudit')).status).toBe(403);
    expect(
      (await h.as(adminOf(club), 'listAudit', { query: { cursor: 'not-a-cursor' } })).status,
    ).toBe(400);
  });
});
