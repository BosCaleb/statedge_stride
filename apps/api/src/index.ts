import { app } from '@azure/functions';
import './functions/routes';
import { preflight } from './functions/preflight';
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
