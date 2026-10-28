import { ApiError, notFound } from '../lib/errors';
import { route } from '../lib/http';
import { isUniqueViolation } from '../lib/sqlErrors';
import { getAnalysisSummary } from '../repo/analysisStore';
import { deleteNote, upsertNote } from '../repo/notes';

// Coach notes on a saved analysis. Last write wins.

route('putNote', ({ coach, params, body, withOrg }) =>
  withOrg(async (db) => {
    if (!(await getAnalysisSummary(db, body.analysisId)))
      throw notFound('The analysis was not found');
    let written;
    try {
      written = await upsertNote(db, coach.orgId, coach.id, params.id, body);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('conflict', 'This id is already in use');
      throw error;
    }
    if (!written) throw new ApiError('conflict', 'This note belongs to another analysis');
    return { created: written.created, body: written.note };
  }),
);

route('deleteNote', ({ params, withOrg }) =>
  withOrg(async (db) => {
    if (!(await deleteNote(db, params.id))) throw notFound();
  }),
);
