// Importing a route module binds its handlers (see lib/http.ts). index.ts and the tests import
// this one module so that both see the same set of routes.
import './health';
import './me';
import './org';
import './invites';
import './athletes';
import './sessions';
import './devices';
import './captures';
import './analyses';
import './notes';
