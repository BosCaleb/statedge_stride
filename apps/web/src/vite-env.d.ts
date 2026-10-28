/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENTRA_TENANT_SUBDOMAIN?: string;
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_API_SCOPE?: string;
  readonly APPLICATIONINSIGHTS_CONNECTION_STRING?: string;
  /** "true" in end-to-end test builds: fake sign-in and the recorded-fixture pose estimator. */
  readonly VITE_E2E?: string;
  /** "true" to include the developer pages (spike page, component gallery) in a build. */
  readonly VITE_ENABLE_DEV_PAGES?: string;
  /** Build identifier shown in support codes and sent with telemetry. */
  readonly VITE_BUILD_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
