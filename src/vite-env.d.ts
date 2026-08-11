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
   * API (it owns tenant provisioning). Unset in dev, where vite.config.ts
   * proxies `/api/onboarding` to localhost:3105 instead.
   */
  readonly VITE_ONBOARDING_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
