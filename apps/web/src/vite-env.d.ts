/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENTRA_TENANT_SUBDOMAIN?: string;
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_API_SCOPE?: string;
  readonly APPLICATIONINSIGHTS_CONNECTION_STRING?: string;
  /** "true" to sign in as a seeded person without Entra (local development and test builds). */
  readonly VITE_FAKE_AUTH?: string;
  /** "true" in end-to-end test builds: also swaps in the recorded-fixture pose estimator. */
  readonly VITE_E2E?: string;
  /** "true" to include the developer pages (spike page, component gallery) in a build. */
  readonly VITE_ENABLE_DEV_PAGES?: string;
  /** Build identifier shown in support codes and sent with telemetry. */
  readonly VITE_BUILD_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
