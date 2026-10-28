import { route } from '../lib/http';
import { meFor } from '../repo/org';

/** GET /v1/me: the signed-in coach, their organisation, role, seats used and retention. */
route('me', async ({ coach, withOrg }) => ({ body: await withOrg((db) => meFor(db, coach)) }));
