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
      '/api': {
        target: 'http://localhost:3106',
        changeOrigin: true,
      },
    },
  },
})
