import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import { getClip, putCalibration, putClip, type WriteOutcome } from '../repo/captures';

// Calibrations and clip metadata. Immutable once written; the video itself stays on the phone.

const MISSING_DETAIL = {
  session: 'The session was not found',
  athlete: 'The athlete was not found',
  calibration: 'The calibration was not found in this session',
  clip: 'The clip was not found',
  analysis: 'The analysis was not found',
} as const;

/** 201 for a first write, 200 for a repeat, 409 for different content, 404 for a missing link. */
export function reply<T>(outcome: WriteOutcome<T>): { created: boolean; body: T } {
  switch (outcome.kind) {
    case 'created':
      return { created: true, body: outcome.value };
    case 'same':
      return { created: false, body: outcome.value };
    case 'different':
      throw new ApiError('conflict', 'This id was already written with different content');
    case 'missing':
      throw notFound(MISSING_DETAIL[outcome.what]);
  }
}

async function guarded<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    // The id exists, but not in this organisation.
    if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
    throw error;
  }
}

route('putCalibration', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) =>
    reply(await guarded(() => putCalibration(db, coach.orgId, params.id, body))),
  ),
);

route('putClip', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => reply(await guarded(() => putClip(db, coach.orgId, params.id, body)))),
);

route('getClip', ({ params, withOrg }) =>
  withOrg(async (db) => {
    const clip = await getClip(db, params.id);
    if (!clip) throw notFound();
    return { body: clip };
  }),
);
