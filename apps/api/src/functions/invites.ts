import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import { hashToken } from '../lib/tokens';
import {
  coachByOid,
  insertCoach,
  inviteByHash,
  markInviteAccepted,
  reactivateCoach,
  seatCounts,
} from '../repo/members';
import { meFor } from '../repo/org';

/**
 * POST /v1/invites/accept: the invite must exist, be unexpired and unused, be for the token's
 * email, and a seat must be free. Repeating the call after it succeeded returns the same coach.
 */
route('acceptInvite', async ({ identity, body, services }) => {
  const email = identity.email;
  if (!email) throw new ApiError('forbidden', 'Your sign-in did not include an email address');
  const me = await services.db
    .withInviteToken(hashToken(body.token), async (db, enterOrg) => {
      const invite = await inviteByHash(db, hashToken(body.token));
      if (!invite || invite.expires_at.getTime() <= services.now().getTime()) throw notFound();
      const orgId = invite.org_id.toLowerCase();
      await enterOrg(orgId);
      if (invite.email.toLowerCase() !== email) {
        throw new ApiError('forbidden', 'This invite was sent to a different email address');
      }
      const existing = await coachByOid(db, identity.oid);
      if (invite.accepted_at !== null) {
        if (existing?.status === 'active') {
          return meFor(db, {
            id: existing.id,
            orgId,
            email,
            displayName: identity.name,
            role: invite.role,
          });
        }
        throw new ApiError('conflict', 'This invite has already been used');
      }
      const seats = await seatCounts(db, orgId);
      // This invite is one of the pending ones; accepting it turns it into an active coach.
      if (existing?.status !== 'active' && seats.active + seats.pending > seats.maxCoaches) {
        throw new ApiError('seat_limit');
      }
      let coachId: string;
      if (existing) {
        coachId = existing.id;
        await reactivateCoach(db, coachId, invite.role, identity.name);
      } else {
        coachId = await insertCoach(db, {
          orgId,
          oid: identity.oid,
          email,
          displayName: identity.name,
          role: invite.role,
        });
      }
      await markInviteAccepted(db, invite.id);
      return meFor(db, {
        id: coachId,
        orgId,
        email,
        displayName: identity.name,
        role: invite.role,
      });
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error))
        throw new ApiError('conflict', 'This account already belongs to another organisation');
      throw error;
    });
  services.coaches.forget(identity.oid);
  return { body: me };
});
