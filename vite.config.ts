import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Dev server only: POST /__save?path=public/fallback.webm writes the request body
// into the project. Used to store recordings and images captured from our own
// canvas. It is not part of the production build.
function saveFromBrowser(): Plugin {
  return {
    name: 'save-from-browser',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (request, response) => {
        const root = server.config.root
        const path = new URL(request.url ?? '', 'http://localhost').searchParams.get('path') ?? ''
        const target = resolve(root, path)
        const allowed = [resolve(root, 'public'), resolve(root, 'docs')]
        if (request.method !== 'POST' || !allowed.some((dir) => target.startsWith(dir + sep))) {
          response.statusCode = 400
          response.end('refused')
          return
        }
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          const body = Buffer.concat(chunks)
          mkdir(dirname(target), { recursive: true })
            .then(() => writeFile(target, body))
            .then(() => response.end(`saved ${path} (${body.length} bytes)`))
            .catch((error) => {
              response.statusCode = 500
              response.end(String(error))
            })
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [saveFromBrowser()],
})
