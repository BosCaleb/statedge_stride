import { route } from '../lib/http';
import { loadOrganisation } from '../lib/org';

/** GET /v1/me: the signed-in coach, their organisation, role, seats used and retention. */
route('me', async ({ coach, withOrg }) => {
  const { organisation, seatsUsed } = await withOrg((db) => loadOrganisation(db, coach.orgId));
  return {
    body: {
      coach: { id: coach.id, email: coach.email, displayName: coach.displayName, role: coach.role },
      organisation,
      seatsUsed,
    },
  };
});
