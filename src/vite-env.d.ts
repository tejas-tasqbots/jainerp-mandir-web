/// <reference types="vite/client" />

/**
 * Build-time configuration this app reads from `import.meta.env`.
 *
 * Declared explicitly rather than left to `vite/client`'s index signature so a
 * typo in a variable name is a compile error rather than `undefined` at
 * runtime — which, for the onboarding API base URL, would silently send every
 * registration request to the wrong origin.
 */
interface ImportMetaEnv {
  /**
   * Origin of superadmin-api, which serves the PUBLIC self-serve onboarding
   * API (it owns tenant provisioning).
   *
   * Optional at every stage: under `vite dev` the relative `/api/onboarding`
   * proxy is used, and a production build falls back to the deployed host. It
   * exists to point a build at a different API (staging, a branch deploy).
   */
  readonly VITE_ONBOARDING_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
