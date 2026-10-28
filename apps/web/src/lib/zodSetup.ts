// zod 4 compiles object parsers with new Function() when it can, and probes for that when each
// object schema is created. The content security policy forbids eval-like code, and even the
// caught probe is reported as a violation, so zod must be told before it first loads: it adopts
// globalThis.__zod_globalConfig as its configuration. This module imports nothing and is the
// first import of every entry point (main.tsx and the analysis worker).

const host = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
(host.__zod_globalConfig ??= {}).jitless = true;
