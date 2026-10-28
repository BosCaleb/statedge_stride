import { ApiError } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import { insertDeviceCheck, listDeviceProfiles } from '../repo/devices';

// Device checks and the tested phone list.

route('postDeviceCheck', ({ coach, body, withOrg }) =>
  withOrg(async (db) => {
    try {
      const { created, createdAt } = await insertDeviceCheck(db, coach.orgId, body);
      return { created, body: { id: body.id, createdAt: createdAt.toISOString() } };
    } catch (error) {
      // Another organisation's check, hidden by row-level security, already has this id.
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
  }),
);

/** Public and cacheable: the list holds no personal data. */
route('deviceProfiles', ({ services }) =>
  services.db.withoutOrg(async (db) => ({ body: { items: await listDeviceProfiles(db) } })),
);
