import { app } from '@azure/functions';

/** GET /v1/health: status and build version. Never touches the database. */
app.http('health', {
  methods: ['GET'],
  route: 'v1/health',
  authLevel: 'anonymous',
  handler: () =>
    Promise.resolve({
      status: 200,
      jsonBody: { status: 'ok', version: process.env.BUILD_VERSION ?? 'dev' },
      headers: { 'Cache-Control': 'no-store' },
    }),
});
