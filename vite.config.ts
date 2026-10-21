import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the build works when loaded over file:// inside the
  // Electron desktop apps (absolute /assets/... resolves to the FS root and
  // 404s) - they run `npm run build` here and package dist/ as it is.
  //
  // The SERVED site must not be relative (tester report 2026-10-20): it uses
  // real paths (BrowserRouter), so reloading /staff/attendance asked for
  // /staff/assets/index-*.js, nginx answered with index.html, and the page
  // died with "Expected a JavaScript module script but the server responded
  // with a MIME type of text/html" - on every route two segments deep. The
  // logo (`${BASE_URL}logo.svg`) was broken there the same way. The Dockerfile
  // sets WEB_BASE=/ for the image dev and prod serve.
  //
  // Exactly '/' or nothing: Git Bash on Windows rewrites a bare "/" in an
  // environment variable to its install path ("/Program Files/Git/"), and an
  // absolute base pointing there would 404 every asset. Anything else falls
  // back to the relative build, which nginx's nested-assets rule still serves.
  base: process.env.WEB_BASE === '/' ? '/' : './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Self-serve registration talks to superadmin-api, which owns tenant
      // provisioning. Declared BEFORE '/api' so the more specific prefix wins.
      '/api/onboarding': {
        target: 'http://localhost:3105',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/onboarding/, ''),
      },
      // VITE_API_PROXY points dev at another mandiradmin-api (a QA stack on a
      // scratch database) without editing this file.
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3106',
        changeOrigin: true,
      },
    },
  },
})
