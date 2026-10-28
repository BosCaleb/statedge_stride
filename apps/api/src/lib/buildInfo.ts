// The build version, baked into the bundle by scripts/build.ts (the commit in CI) so that the
// deploy workflow's health check can confirm which build is live. Undefined when run unbundled.

declare const __STRIDE_BUILD_VERSION__: string | undefined;

export const BAKED_BUILD_VERSION: string | undefined =
  typeof __STRIDE_BUILD_VERSION__ === 'string' ? __STRIDE_BUILD_VERSION__ : undefined;
