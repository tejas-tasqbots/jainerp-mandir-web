import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset paths so the build works when loaded over file:// inside the
  // Electron desktop app (absolute /assets/... resolves to the FS root and 404s).
  base: './',
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
