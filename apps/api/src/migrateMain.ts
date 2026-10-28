import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate';

// Entry point of the bundled .deploy/migrate.mjs, which ships with a migrations folder beside it.
const here = dirname(fileURLToPath(import.meta.url));
migrate(process.argv.slice(2), join(here, 'migrations')).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
