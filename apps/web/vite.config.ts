import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

/**
 * Writes staticwebapp.config.json for the build's environment: security headers and the content
 * security policy, which names exactly the API, sign-in and telemetry origins of that build.
 */
function staticWebAppConfig(env: Record<string, string>): Plugin {
  const origin = (url: string | undefined) => {
    try {
      return url ? new URL(url).origin : null;
    } catch {
      return null;
    }
  };
  const api = origin(env.VITE_API_BASE_URL);
  const sub = env.VITE_ENTRA_TENANT_SUBDOMAIN;
  const signIn = env.VITE_FAKE_AUTH === 'true' || !sub ? null : `https://${sub}.ciamlogin.com`;
  const telemetry = env.APPLICATIONINSIGHTS_CONNECTION_STRING
    ? 'https://*.in.applicationinsights.azure.com'
    : null;
  const list = (...items: (string | null)[]) =>
    items.filter((i): i is string => i !== null).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    `connect-src ${list("'self'", api, signIn, telemetry)}`,
    `frame-src ${signIn ?? "'none'"}`,
    `form-action ${list("'self'", signIn)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const immutable = { 'Cache-Control': 'public, max-age=31536000, immutable' };
  const config = {
    globalHeaders: {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    },
    routes: [
      { route: '/r/*', headers: { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } },
      { route: '/models/*', headers: immutable },
      { route: '/assets/*', headers: immutable },
      { route: '/fonts/*', headers: immutable },
      { route: '/sw.js', headers: { 'Cache-Control': 'no-cache' } },
      { route: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
    ],
    navigationFallback: {
      rewrite: '/index.html',
      exclude: [
        '/models/*',
        '/assets/*',
        '/fonts/*',
        '/icons/*',
        '/*.{js,css,json,png,svg,ico,webmanifest,txt}',
      ],
    },
    mimeTypes: {
      '.task': 'application/octet-stream',
      '.wasm': 'application/wasm',
      '.webmanifest': 'application/manifest+json',
    },
  };
  return {
    name: 'stride-static-web-app-config',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'staticwebapp.config.json',
        source: `${JSON.stringify(config, null, 2)}\n`,
      });
    },
  };
}

/**
 * End-to-end test builds only (VITE_E2E=true): ships the recorded keypoint fixtures at
 * /e2e-fixtures/, for the fixture pose estimator. Other builds never contain them.
 */
function e2eFixtures(enabled: boolean): Plugin {
  return {
    name: 'stride-e2e-fixtures',
    apply: 'build',
    async generateBundle() {
      if (!enabled) return;
      const dir = fileURLToPath(new URL('../../fixtures/keypoints/', import.meta.url));
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.skp1.gz')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `e2e-fixtures/${name}`,
          source: await readFile(join(dir, name)),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'APPLICATIONINSIGHTS_']);
  return {
    plugins: [
      react(),
      serveModelsInDev(),
      staticWebAppConfig(env),
      e2eFixtures(env.VITE_E2E === 'true'),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
        manifest: {
          name: 'StatEdge Stride',
          short_name: 'Stride',
          description: 'Running technique analysis from slow-motion video, on the phone.',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          theme_color: '#0D1C3E',
          background_color: '#0D1C3E',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The app shell, fonts, every route chunk (the guide and the offline analysis loop
          // included) and the strings. Not the pose model: it is large and fetched on demand.
          globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
          globIgnores: ['models/**'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/models\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith('/models/'),
              handler: 'CacheFirst',
              options: { cacheName: 'models-v1', cacheableResponse: { statuses: [200] } },
            },
          ],
        },
      }),
    ],
    envPrefix: ['VITE_', 'APPLICATIONINSIGHTS_'],
    build: {
      target: 'es2022',
      sourcemap: true,
    },
    worker: {
      format: 'es',
    },
  };
});
