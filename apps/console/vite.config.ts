import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Where the dev proxy sends the API. Production serves this build from the same origin.
const api = process.env.TRIBUTARY_PROXY_TARGET ?? 'http://localhost:4100'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { target: 'es2022', sourcemap: false },
  // MapLibre's tile decoder is a module worker. Without this Vite emits it as a classic
  // script, whose `import` of the shared chunk fails at load with nothing useful in the
  // console beyond "Worker failed to load".
  worker: { format: 'es' },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/oauth/client-metadata.json': { target: api, changeOrigin: false },
      '/oauth/jwks.json': { target: api, changeOrigin: false },
      '/oauth/callback': { target: api, changeOrigin: false },
      // The email deep link is a console route; the API only answers the JSON form under /api.
    },
  },
})
