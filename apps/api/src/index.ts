import { app } from '@azure/functions';
import './functions/routes';
import { preflight } from './functions/preflight';
import { retentionSweep } from './functions/retentionSweep';
import { registeredRoutes } from './lib/http';

// Entry point for the Azure Functions host (package.json "main"). Every route of the shared
// registry that has a handler is registered here with the v4 programming model. Authentication
// is our own middleware, so the host-level auth level is anonymous.

for (const r of registeredRoutes()) {
  app.http(r.name, {
    methods: [r.def.method],
    route: r.def.path.slice(1),
    authLevel: 'anonymous',
    handler: r.handle,
  });
}

app.http('preflight', {
  methods: ['OPTIONS'],
  route: '{*path}',
  authLevel: 'anonymous',
  handler: preflight,
});

// Daily at 00:00 UTC (02:00 in South Africa). The host's NCRONTAB has a seconds field, so the
// specification's "0 0 * * *" is written with a leading 0.
app.timer('retention-sweep', {
  schedule: '0 0 0 * * *',
  runOnStartup: false,
  handler: retentionSweep,
});
