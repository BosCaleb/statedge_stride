import { consentRuleProblem } from '@stride/shared/consent';
import { LIMITS } from '@stride/shared/limits';
import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import {
  confirmsName,
  deleteAthlete,
  findAthlete,
  getAthlete,
  listAthletes,
  upsertAthlete,
} from '../repo/athletes';
import { audit } from '../repo/audit';
import {
  activeConsent,
  consentHistory,
  getConsent,
  insertConsent,
  sameConsent,
  withdrawConsent,
} from '../repo/consents';
import { exportAthlete } from '../repo/export';

// Athletes and their consents. Consent rules are enforced here, never only in the web app.

route('listAthletes', ({ coach, query, withOrg }) =>
  withOrg(async (db) => ({
    body: await listAthletes(db, coach.orgId, {
      q: query.q,
      limit: query.limit ?? LIMITS.pageDefault,
      cursor: query.cursor,
    }),
  })),
);

route('putAthlete', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => {
    let created: boolean;
    try {
      created = await upsertAthlete(db, params.id, coach.orgId, coach.id, body);
    } catch (error) {
      // The id exists, but not in this organisation.
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    if (created)
      await audit(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        action: 'athlete.create',
        targetType: 'athlete',
        targetId: params.id,
      });
    const athlete = await getAthlete(db, params.id);
    if (!athlete) throw new Error('athlete vanished after write');
    return { created, body: athlete };
  }),
);

route('getAthlete', ({ params, withOrg }) =>
  withOrg(async (db) => {
    const athlete = await getAthlete(db, params.id);
    if (!athlete) throw notFound();
    return { body: athlete };
  }),
);

route('deleteAthlete', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => {
    const row = await findAthlete(db, params.id);
    if (!row) throw notFound();
    if (!confirmsName(row, body.confirmName)) {
      throw new ApiError('validation', "The name does not match the athlete's name", [
        { path: 'body.confirmName', message: 'Type the full name to confirm' },
      ]);
    }
    await deleteAthlete(db, params.id, coach.id);
  }),
);

route('listConsents', ({ params, withOrg }) =>
  withOrg(async (db) => {
    if (!(await findAthlete(db, params.id))) throw notFound();
    return { body: { items: await consentHistory(db, params.id) } };
  }),
);

route('putConsent', ({ coach, params, body, withOrg, services }) =>
  withOrg(async (db) => {
    const athlete = await findAthlete(db, body.athleteId);
    if (!athlete) throw notFound();
    const stored = await getConsent(db, params.id);
    if (stored) {
      if (!sameConsent(stored, body))
        throw new ApiError('conflict', 'A consent cannot be changed once recorded');
      return { created: false, body: stored };
    }
    const problem = consentRuleProblem(
      athlete.birth_year,
      services.now().getUTCFullYear(),
      body.givenBy,
      body.evidence,
    );
    if (problem) {
      const errors = {
        guardian_required: {
          path: 'body.givenBy',
          message: 'A parent or guardian must consent for an athlete aged 18 or under this year',
        },
        verbal_not_allowed: {
          path: 'body.evidence',
          message: 'Verbal consent is allowed for adult athletes only',
        },
        digital_reserved: {
          path: 'body.evidence',
          message: 'Digital consent is not available yet',
        },
      }[problem];
      throw new ApiError('validation', errors.message, [errors]);
    }
    if (await activeConsent(db, body.athleteId, body.purpose)) {
      throw new ApiError(
        'conflict',
        'An active consent for this purpose exists; withdraw it first',
      );
    }
    try {
      await insertConsent(db, params.id, coach.orgId, coach.id, body);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'consent.record',
      targetType: 'consent',
      targetId: params.id,
      detail: body.purpose,
    });
    const consent = await getConsent(db, params.id);
    if (!consent) throw new Error('consent vanished after write');
    return { created: true, body: consent };
  }),
);

route('withdrawConsent', ({ coach, params, withOrg }) =>
  withOrg(async (db) => {
    const consent = await getConsent(db, params.id);
    if (!consent) throw notFound();
    if (await withdrawConsent(db, params.id)) {
      await audit(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        action: 'consent.withdraw',
        targetType: 'consent',
        targetId: params.id,
        detail: consent.purpose,
      });
    }
    const updated = await getConsent(db, params.id);
    if (!updated) throw new Error('consent vanished after withdrawal');
    return { body: updated };
  }),
);

route('exportAthlete', ({ coach, params, withOrg, services }) =>
  withOrg(async (db) => {
    const data = await exportAthlete(db, coach.orgId, params.id, services.now());
    if (!data) throw notFound();
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'export.athlete',
      targetType: 'athlete',
      targetId: params.id,
    });
    return { body: data };
  }),
);
