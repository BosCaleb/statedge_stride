import { LIMITS } from '@stride/shared/limits';
import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { webOrigin } from '../lib/origin';
import { newToken } from '../lib/tokens';
import { audit, listAudit } from '../repo/audit';
import {
  deletePendingInvite,
  insertInvite,
  listMembers,
  pendingInvites,
  removeCoach,
  seatCounts,
  setRetentionDays,
  withdrawPendingInvites,
} from '../repo/members';
import { loadOrganisation } from '../repo/org';

// Organisation settings, members and invites (administrators only).

route('patchOrg', ({ coach, body, withOrg }) =>
  withOrg(async (db) => {
    await setRetentionDays(db, coach.orgId, body.clipRetentionDays);
    return { body: (await loadOrganisation(db, coach.orgId)).organisation };
  }),
);

route('listMembers', ({ coach, withOrg }) =>
  withOrg(async (db) => {
    // One transaction runs one request at a time.
    const members = await listMembers(db, coach.orgId);
    const invites = await pendingInvites(db, coach.orgId);
    const seats = await seatCounts(db, coach.orgId);
    return {
      body: {
        items: members.map(({ entraOid: _oid, ...m }) => m),
        pendingInvites: invites.map((i) => ({
          id: i.id.toLowerCase(),
          email: i.email,
          role: i.role,
          expiresAt: i.expires_at.toISOString(),
          createdAt: i.created_at.toISOString(),
        })),
        maxCoaches: seats.maxCoaches,
        seatsUsed: seats.active + seats.pending,
      },
    };
  }),
);

route('removeMember', async ({ coach, params, withOrg, services }) => {
  if (params.coachId === coach.id) throw new ApiError('forbidden', 'You cannot remove yourself');
  const result = await withOrg(async (db) => {
    const removed = await removeCoach(db, params.coachId);
    if (removed.removed) {
      await audit(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        action: 'member.remove',
        targetType: 'coach',
        targetId: params.coachId,
      });
    }
    return removed;
  });
  if (!result.removed) throw notFound();
  if (result.oid) services.coaches.forget(result.oid);
});

route('createInvite', ({ coach, body, withOrg, request, services }) =>
  withOrg(async (db) => {
    const email = body.email.toLowerCase();
    const members = await listMembers(db, coach.orgId);
    if (members.some((m) => m.status === 'active' && m.email.toLowerCase() === email)) {
      throw new ApiError('conflict', 'This person is already a member');
    }
    await withdrawPendingInvites(db, coach.orgId, email);
    const seats = await seatCounts(db, coach.orgId);
    if (seats.active + seats.pending >= seats.maxCoaches) throw new ApiError('seat_limit');
    const { token, hash } = newToken();
    const invite = await insertInvite(db, {
      orgId: coach.orgId,
      email,
      role: body.role,
      hash,
      createdBy: coach.id,
    });
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'member.invite',
      targetType: 'invite',
      targetId: invite.id,
    });
    return {
      created: true,
      body: {
        id: invite.id,
        url: `${webOrigin(request, services.config)}/invite/${token}`,
        expiresAt: invite.expiresAt.toISOString(),
      },
    };
  }),
);

route('revokeInvite', async ({ params, withOrg }) => {
  if (!(await withOrg((db) => deletePendingInvite(db, params.id)))) throw notFound();
});

route('listAudit', ({ coach, query, withOrg }) =>
  withOrg(async (db) => ({
    body: await listAudit(db, coach.orgId, query.limit ?? LIMITS.pageDefault, query.cursor),
  })),
);
