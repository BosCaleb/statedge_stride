import { LIMITS } from '@stride/shared/limits';
import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import { getSession, listSessions, sessionDetail, upsertSession } from '../repo/sessionsRepo';

// Sessions: one capture occasion with its calibrations, clips and analyses.

route('listSessions', ({ coach, query, withOrg }) =>
  withOrg(async (db) => ({
    body: await listSessions(db, coach.orgId, {
      limit: query.limit ?? LIMITS.pageDefault,
      cursor: query.cursor,
      athleteId: query.athleteId,
      from: query.from,
      to: query.to,
    }),
  })),
);

route('putSession', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => {
    let created: boolean;
    try {
      created = await upsertSession(db, params.id, coach.orgId, coach.id, body);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    const session = await getSession(db, params.id);
    if (!session) throw new Error('session vanished after write');
    return { created, body: session };
  }),
);

route('getSession', ({ params, withOrg }) =>
  withOrg(async (db) => {
    const detail = await sessionDetail(db, params.id);
    if (!detail) throw notFound();
    return { body: detail };
  }),
);
