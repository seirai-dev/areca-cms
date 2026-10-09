// Serves the built static site (dist/client) the same way nginx does in the
// Docker image: /path -> /path/index.html, unknown paths -> /404 page.
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..', 'dist', 'client')
const port = Number(process.env.PORT ?? 3100)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function resolveFile(pathname) {
  const base = normalize(join(root, decodeURIComponent(pathname)))
  if (!base.startsWith(root)) return null
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  let file = resolveFile(pathname)
  let status = 200
  if (!file) {
    file = resolveFile('/404')
    status = 404
  }
  res.writeHead(status, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
  })
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`Docs preview on http://localhost:${port}`)
})
