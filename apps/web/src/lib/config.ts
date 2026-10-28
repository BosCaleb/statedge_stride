import './zodSetup';
import { z } from 'zod';

// Build-time settings from the Vite environment (.env.<mode> files hold the public values for
// each environment; none of them is a secret).

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    VITE_API_BASE_URL: z.url(),
    /** The External ID tenant's sign-in host is <subdomain>.ciamlogin.com. */
    VITE_ENTRA_TENANT_SUBDOMAIN: z
      .string()
      .regex(/^[a-z0-9-]+$/i)
      .optional(),
    VITE_ENTRA_CLIENT_ID: z.guid().optional(),
    /** The full scope, such as api://<api-client-id>/access_as_user. */
    VITE_API_SCOPE: z.string().min(1).optional(),
    /** Sign in as a seeded person without Entra. Local development and test builds only. */
    VITE_FAKE_AUTH: flag,
    /** End-to-end test build: also swaps in the recorded-fixture pose estimator. */
    VITE_E2E: flag,
    VITE_ENABLE_DEV_PAGES: flag,
    VITE_BUILD_VERSION: z.string().min(1).default('dev'),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
  })
  .refine(
    (e) =>
      e.VITE_FAKE_AUTH ||
      (e.VITE_ENTRA_TENANT_SUBDOMAIN !== undefined &&
        e.VITE_ENTRA_CLIENT_ID !== undefined &&
        e.VITE_API_SCOPE !== undefined),
    'Entra settings are required unless VITE_FAKE_AUTH is true',
  );

export interface WebConfig {
  apiBaseUrl: string;
  entra: { authority: string; knownAuthority: string; clientId: string; scope: string } | null;
  fakeAuth: boolean;
  e2e: boolean;
  devPages: boolean;
  buildVersion: string;
  appInsightsConnectionString: string | undefined;
}

export function parseConfig(env: Record<string, unknown>): WebConfig {
  const e = envSchema.parse(env);
  const sub = e.VITE_ENTRA_TENANT_SUBDOMAIN;
  return {
    apiBaseUrl: e.VITE_API_BASE_URL.replace(/\/$/, ''),
    entra:
      e.VITE_FAKE_AUTH || !sub || !e.VITE_ENTRA_CLIENT_ID || !e.VITE_API_SCOPE
        ? null
        : {
            authority: `https://${sub}.ciamlogin.com/`,
            knownAuthority: `${sub}.ciamlogin.com`,
            clientId: e.VITE_ENTRA_CLIENT_ID,
            scope: e.VITE_API_SCOPE,
          },
    fakeAuth: e.VITE_FAKE_AUTH,
    e2e: e.VITE_E2E,
    devPages: e.VITE_ENABLE_DEV_PAGES,
    buildVersion: e.VITE_BUILD_VERSION,
    appInsightsConnectionString: e.APPLICATIONINSIGHTS_CONNECTION_STRING,
  };
}

export const config: WebConfig = parseConfig(import.meta.env);
