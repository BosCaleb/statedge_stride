import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev server only: MediaPipe loads its self-hosted WASM loader with a runtime import(), to which
 * the dev server appends `?import`; public files are not served with that query. Strip it for
 * /models so the dev server behaves like the static host. Production builds are unaffected.
 */
function serveModelsInDev(): Plugin {
  return {
    name: 'stride-serve-models-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/models/'))
          req.url = req.url.replace(/\?import$/, '').replace(/[?&]import&/, '?');
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveModelsInDev()],
  envPrefix: ['VITE_', 'APPLICATIONINSIGHTS_'],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
