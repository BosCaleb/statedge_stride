import { route } from '../lib/http';

/** GET /v1/health: status and build version. Never touches the database. */
route('health', ({ services }) =>
  Promise.resolve({ body: { status: 'ok', version: services.config.buildVersion } }),
);
