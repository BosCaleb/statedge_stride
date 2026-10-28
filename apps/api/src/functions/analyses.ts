import { gunzipSync } from 'node:zlib';
import { readSkp1Header } from '@stride/analysis/skp1';
import { isMinor } from '@stride/shared/consent';
import { LIMITS } from '@stride/shared/limits';
import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import {
  athleteHistory,
  canonicalResult,
  deleteAnalysis,
  getAnalysis,
  getAnalysisSummary,
  getKeypoints,
  insertAnalysis,
  setKeypoints,
  storedAnalysis,
} from '../repo/analysisStore';
import { findAthlete } from '../repo/athletes';
import { audit } from '../repo/audit';
import { getClip } from '../repo/captures';
import { activeConsent } from '../repo/consents';

// Saved analyses. The server decides what may be stored, whatever the client says: an active
// analysis consent (from a parent or guardian for a minor), a result that passed the gate, and
// plausible values (the body schema). Results are immutable; keypoints are written once.

route('putAnalysis', ({ coach, params, body, withOrg, services }) =>
  withOrg(async (db) => {
    const stored = await storedAnalysis(db, params.id);
    if (stored) {
      const same =
        stored.clipId === body.clipId &&
        stored.athleteId === body.athleteId &&
        stored.result === canonicalResult(body.result);
      if (!same)
        throw new ApiError('conflict', 'This analysis was already saved with different content');
      const summary = await getAnalysisSummary(db, params.id);
      if (!summary) throw new Error('analysis vanished');
      return { created: false, body: summary };
    }

    if (body.result.gate.status === 'fail')
      throw new ApiError('gate_failed', 'A result that failed the quality gate cannot be saved');
    const clip = await getClip(db, body.clipId);
    if (!clip) throw notFound('The clip was not found');
    if (clip.role !== 'run' || clip.athleteId !== body.athleteId) {
      throw new ApiError('validation', 'The clip is not a run of this athlete', [
        { path: 'body.athleteId', message: 'Must be the athlete of the run clip' },
      ]);
    }
    const athlete = await findAthlete(db, body.athleteId);
    if (!athlete) throw notFound('The athlete was not found');
    const consent = await activeConsent(db, body.athleteId, 'analysis');
    const year = services.now().getUTCFullYear();
    if (!consent) throw new ApiError('consent_required', 'There is no active consent for analysis');
    if (isMinor(athlete.birth_year, year) && consent.givenBy !== 'guardian') {
      throw new ApiError(
        'consent_required',
        'The analysis consent for a minor must come from a parent or guardian',
      );
    }
    if (body.supersedes) {
      const old = await getAnalysisSummary(db, body.supersedes);
      if (!old || old.clipId !== body.clipId) {
        throw new ApiError('validation', 'Only an analysis of the same clip can be replaced', [
          { path: 'body.supersedes', message: 'Must be an analysis of the same clip' },
        ]);
      }
    }

    try {
      await insertAnalysis(db, coach.orgId, coach.id, params.id, body);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'analysis.save',
      targetType: 'analysis',
      targetId: params.id,
    });
    const summary = await getAnalysisSummary(db, params.id);
    if (!summary) throw new Error('analysis not visible after insert');
    return { created: true, body: summary };
  }),
);

/** Decompresses with a cap, so that a small upload cannot expand without limit. */
function gunzipCapped(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;
  try {
    return gunzipSync(bytes, { maxOutputLength: LIMITS.keypointsDecompressedBytes });
  } catch {
    return null;
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));

route('putKeypoints', ({ params, body, withOrg }) =>
  withOrg(async (db) => {
    const existing = await getKeypoints(db, params.id);
    if (existing === undefined) throw notFound('The analysis was not found');
    if (existing) {
      if (!sameBytes(existing, body))
        throw new ApiError('conflict', 'Keypoints were already stored for this analysis');
      return { created: false, body: { bytes: existing.byteLength } };
    }
    const raw = gunzipCapped(body);
    if (!raw) {
      throw new ApiError('validation', 'Not a gzip file, or too large once decompressed', [
        { path: 'body', message: 'Must be a gzip-compressed SKP1 file' },
      ]);
    }
    const header = readSkp1Header(raw);
    const summary = await getAnalysisSummary(db, params.id);
    const clip = summary ? await getClip(db, summary.clipId) : null;
    if (
      !header.ok ||
      !clip ||
      header.value.frameCount !== clip.frameCount ||
      header.value.widthPx !== clip.widthPx ||
      header.value.heightPx !== clip.heightPx
    ) {
      throw new ApiError('validation', 'The keypoint file does not match the clip', [
        { path: 'body', message: header.ok ? 'Frame count or size differs' : header.reason },
      ]);
    }
    if (!(await setKeypoints(db, params.id, body)))
      throw new ApiError('conflict', 'Keypoints were already stored for this analysis');
    return { created: true, body: { bytes: body.byteLength } };
  }),
);

route('getAnalysis', ({ params, withOrg }) =>
  withOrg(async (db) => {
    const analysis = await getAnalysis(db, params.id);
    if (!analysis) throw notFound();
    return { body: analysis };
  }),
);

route('getKeypoints', ({ params, withOrg }) =>
  withOrg(async (db) => {
    const bytes = await getKeypoints(db, params.id);
    if (!bytes) throw notFound();
    return { body: bytes };
  }),
);

route('athleteAnalyses', ({ params, query, withOrg }) =>
  withOrg(async (db) => {
    if (!(await findAthlete(db, params.id))) throw notFound();
    return {
      body: await athleteHistory(db, params.id, {
        limit: query.limit ?? LIMITS.pageDefault,
        cursor: query.cursor,
        mode: query.mode,
      }),
    };
  }),
);

route('deleteAnalysis', ({ coach, params, withOrg }) =>
  withOrg(async (db) => {
    if (!(await deleteAnalysis(db, params.id))) throw notFound();
    await audit(db, {
      orgId: coach.orgId,
      coachId: coach.id,
      action: 'analysis.delete',
      targetType: 'analysis',
      targetId: params.id,
    });
  }),
);
