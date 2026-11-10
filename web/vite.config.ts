import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The built app is served by the Python server (paybybot3 web).
// PAYBYBOT_ADMIN_SAMPLE=1: the admin page shows sample clients (the local server has no admin), dev server only.
const adminSample: Plugin = {
  name: 'admin-sample',
  apply: 'serve',
  async configureServer(server) {
    if (process.env.PAYBYBOT_ADMIN_SAMPLE !== '1') return
    const { adminSample } = await import('./dev/admin-sample.ts')
    server.middlewares.use('/api/admin', (req, res) => {
      const replies: Record<string, unknown> = adminSample()
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(replies[(req.url ?? '').split(/[/?]/)[1]] ?? { ok: true }))
    })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), adminSample],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: '../paybybot3/static', emptyOutDir: true },
  // Dev: the Python server checks that calls come from its own origin, so the proxy presents them as such.
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true, headers: { origin: 'http://127.0.0.1:8765' } } },
  },
})
