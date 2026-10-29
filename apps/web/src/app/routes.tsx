import type { RouteObject } from 'react-router';
import { RouteError } from './ErrorBoundary';
import { StatEdgeLoader } from '../components/StatEdgeLoader';

/** Shown while the first chunks load. */
function BootFallback() {
  return <StatEdgeLoader variant="screen" />;
}

// The route table. Every screen is lazy-loaded, the shell and the auth guard included, so the
// entry chunk stays small; the public report viewer will sit outside AppRoot so that it loads
// neither the sign-in library nor any analysis code. Developer pages are compiled out of
// builds without VITE_ENABLE_DEV_PAGES.

const DEV_PAGES = import.meta.env.VITE_ENABLE_DEV_PAGES === 'true';

const devRoutes: RouteObject[] = DEV_PAGES
  ? [
      {
        path: '/dev/spike',
        lazy: async () => ({ Component: (await import('../features/dev/SpikePage')).SpikePage }),
      },
      {
        lazy: async () => ({ Component: (await import('./AppShell')).AppShell }),
        handle: { appShell: true },
        children: [
          {
            path: '/dev/gallery',
            lazy: async () => ({
              Component: (await import('../features/dev/GalleryPage')).GalleryPage,
            }),
          },
        ],
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    lazy: async () => ({ Component: (await import('./AppRoot')).AppRoot }),
    ErrorBoundary: RouteError,
    HydrateFallback: BootFallback,
    children: [
      {
        path: '/signin',
        lazy: async () => ({ Component: (await import('../features/auth/SignInPage')).SignInPage }),
      },
      {
        path: '/auth/callback',
        lazy: async () => ({
          Component: (await import('../features/auth/AuthCallbackPage')).AuthCallbackPage,
        }),
      },
      {
        path: '/invite/:token',
        lazy: async () => ({ Component: (await import('../features/auth/InvitePage')).InvitePage }),
      },
      {
        lazy: async () => ({ Component: (await import('./AppShell')).AppShell }),
        handle: { appShell: true },
        children: [
          {
            path: '/guide',
            lazy: async () => ({
              Component: (await import('../features/guide/GuidePage')).GuidePage,
            }),
          },
          {
            lazy: async () => ({ Component: (await import('./RequireAuth')).RequireAuth }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../features/home/HomePage')).HomePage,
                }),
              },
              {
                path: '/athletes',
                lazy: async () => ({
                  Component: (await import('../features/athletes/AthletesPage')).AthletesPage,
                }),
              },
              {
                path: '/athletes/new',
                lazy: async () => ({
                  Component: (await import('../features/athletes/AthleteFormPage')).AthleteFormPage,
                }),
              },
              {
                path: '/athletes/:id',
                lazy: async () => ({
                  Component: (await import('../features/athletes/AthletePage')).AthletePage,
                }),
              },
              {
                path: '/athletes/:id/edit',
                lazy: async () => ({
                  Component: (await import('../features/athletes/AthleteFormPage')).AthleteFormPage,
                }),
              },
              {
                path: '/athletes/:id/consent',
                lazy: async () => ({
                  Component: (await import('../features/athletes/ConsentPage')).ConsentPage,
                }),
              },
              {
                path: '/sessions/new',
                lazy: async () => ({
                  Component: (await import('../features/sessions/SessionFormPage')).SessionFormPage,
                }),
              },
              {
                path: '/sessions/:id',
                lazy: async () => ({
                  Component: (await import('../features/sessions/SessionPage')).SessionPage,
                }),
              },
              {
                path: '/sessions/:id/edit',
                lazy: async () => ({
                  Component: (await import('../features/sessions/SessionFormPage')).SessionFormPage,
                }),
              },
              {
                path: '/import',
                lazy: async () => ({
                  Component: (await import('../features/import/ImportPage')).ImportPage,
                }),
              },
              {
                path: '/analyse/:clipId',
                lazy: async () => ({
                  Component: (await import('../features/analyse/AnalysePage')).AnalysePage,
                }),
              },
              {
                path: '/analyses/:id',
                lazy: async () => ({
                  Component: (await import('../features/results/ResultPage')).ResultPage,
                }),
              },
              {
                path: '/compare',
                lazy: async () => ({
                  Component: (await import('../features/compare/ComparePage')).ComparePage,
                }),
              },
              {
                path: '/device-check',
                lazy: async () => ({
                  Component: (await import('../features/device/DeviceCheckPage')).DeviceCheckPage,
                }),
              },
            ],
          },
          {
            path: '/settings',
            lazy: async () => ({ Component: (await import('./RequireAuth')).RequireAdmin }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../features/settings/SettingsPage')).SettingsPage,
                }),
              },
            ],
          },
        ],
      },
      ...devRoutes,
      {
        path: '*',
        lazy: async () => ({
          Component: (await import('../features/errors/NotFoundPage')).NotFoundPage,
        }),
      },
    ],
  },
];
