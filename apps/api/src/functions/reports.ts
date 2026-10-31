import { isMinor } from '@stride/shared/consent';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { webOrigin } from '../lib/origin';
import { isUniqueViolation } from '../lib/sqlErrors';
import { hashToken, newToken } from '../lib/tokens';
import { getAnalysisSummary } from '../repo/analysisStore';
import { findAthlete } from '../repo/athletes';
import { audit } from '../repo/audit';
import { activeConsent } from '../repo/consents';
import {
  deleteShares,
  findReport,
  frameOrdinals,
  getReport,
  insertShare,
  listAthleteReports,
  publicFrame,
  publicReport,
  putFrame,
  upsertReport,
} from '../repo/reports';

// Reports and share links. A report is the coach's private snapshot of one analysis, or of two
// for a comparison. A share link is a public copy of it, reached by a token that is shown once;
// creating one needs an active sharing consent, and the copy always names the athlete by first
// name and last initial, whatever the coach chose for the PDF. Expired, revoked and unknown links
// answer alike, so that tokens cannot be probed.

const GONE = 'This link is no longer available.';
const DAY_MS = 24 * 60 * 60 * 1000;

/** JPEG files start with a start-of-image marker followed by another marker. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

route('putReport', ({ coach, params, body, withOrg, services }) =>
  withOrg(async (db) => {
    const existing = await findReport(db, params.id);
    if (existing && existing.athleteId !== body.athleteId)
      throw new ApiError('conflict', 'This report belongs to another athlete');
    if (!(await findAthlete(db, body.athleteId))) throw notFound('The athlete was not found');
    for (const [i, analysis] of body.snapshot.analyses.entries()) {
      const summary = await getAnalysisSummary(db, analysis.id);
      if (!summary || summary.athleteId !== body.athleteId) {
        throw new ApiError('validation', 'Every analysis of a report must be one of the athlete', [
          {
            path: `body.snapshot.analyses.${i}.id`,
            message: 'Not a saved analysis of the athlete',
          },
        ]);
      }
    }
    let created;
    try {
      created = await upsertReport(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        id: params.id,
        athleteId: body.athleteId,
        snapshot: body.snapshot,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    if (created) {
      await audit(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        action: 'report.create',
        targetType: 'report',
        targetId: params.id,
      });
    }
    const report = await getReport(db, coach.orgId, params.id, services.now());
    if (!report) throw new Error('report not visible after write');
    return { created, body: report };
  }),
);

route('putReportFrame', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => {
    const report = await findReport(db, params.id);
    if (!report) throw notFound('The report was not found');
    if (!report.snapshot.frames.some((f) => f.ordinal === params.ordinal)) {
      throw new ApiError('validation', 'The report has no frame with this number', [
        { path: 'params.ordinal', message: 'Must be the ordinal of one of the report’s frames' },
      ]);
    }
    if (!isJpeg(body)) throw new ApiError('validation', 'The body is not a JPEG image');
    const created = await putFrame(db, coach.orgId, params.id, params.ordinal, body);
    return { created, body: { bytes: body.byteLength } };
  }),
);

route('getReport', async ({ coach, params, withOrg, services }) => {
  const report = await withOrg((db) => getReport(db, coach.orgId, params.id, services.now()));
  if (!report) throw notFound();
  return { body: report };
});

route('listAthleteReports', ({ coach, params, withOrg, services }) =>
  withOrg(async (db) => {
    if (!(await findAthlete(db, params.id))) throw notFound('The athlete was not found');
    return {
      body: { items: await listAthleteReports(db, coach.orgId, params.id, services.now()) },
    };
  }),
);

route('createShare', ({ coach, params, body, withOrg, request, services }) =>
  withOrg(async (db) => {
    const report = await findReport(db, params.id);
    if (!report) throw notFound('The report was not found');
    const athlete = await findAthlete(db, report.athleteId);
    if (!athlete) throw notFound('The athlete was not found');
    const now = services.now();
    const consent = await activeConsent(db, report.athleteId, 'sharing');
    if (!consent) throw new ApiError('consent_required', 'There is no active consent for sharing');
    if (isMinor(athlete.birth_year, now.getUTCFullYear()) && consent.givenBy !== 'guardian') {
      throw new ApiError(
        'consent_required',
        'The sharing consent for a minor must come from a parent or guardian',
      );
    }
    const uploaded = await frameOrdinals(db, report.id);
    if (report.snapshot.frames.some((f) => !uploaded.includes(f.ordinal)))
      throw new ApiError('validation', 'Upload every key frame of the report first');

    const { token, hash } = newToken();
    const expiresAt = new Date(
      Math.floor(now.getTime() / 1000) * 1000 + body.expiresInDays * DAY_MS,
    );
    await insertShare(db, {
      orgId: coach.orgId,
      id: report.id,
      hash,
      expiresAt,
      snapshot: {
        ...report.snapshot,
        athleteDisplayName: shortDisplayName(athlete.first_name, athlete.last_name),
      },
    });
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'share.create',
      targetType: 'report',
      targetId: report.id,
      detail: `expires in ${body.expiresInDays} days`,
    });
    return {
      created: true,
      body: {
        url: `${webOrigin(request, services.config)}/r/${token}`,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }),
);

route('revokeShare', ({ coach, params, withOrg }) =>
  withOrg(async (db) => {
    if (!(await findReport(db, params.id))) throw notFound('The report was not found');
    if (await deleteShares(db, coach.orgId, params.id)) {
      await audit(db, {
        orgId: coach.orgId,
        coachId: coach.id,
        action: 'share.revoke',
        targetType: 'report',
        targetId: params.id,
      });
    }
  }),
);

route('publicReport', async ({ params, services }) => {
  const found = await services.db.withoutOrg((db) =>
    publicReport(db, hashToken(params.token), services.now()),
  );
  if (!found) throw notFound(GONE);
  return { body: { snapshot: found.snapshot, expiresAt: found.expiresAt.toISOString() } };
});

route('publicReportFrame', async ({ params, services }) => {
  const jpeg = await services.db.withoutOrg((db) =>
    publicFrame(db, hashToken(params.token), params.ordinal, services.now()),
  );
  if (!jpeg) throw notFound(GONE);
  return { body: jpeg };
});
