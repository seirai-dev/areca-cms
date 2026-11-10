// Serves the prerendered site (dist/client) for local previews.
// Supports Range requests so the product video can seek, like a real host.
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..', 'dist', 'client')
const port = Number(process.env.PORT ?? 3200)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
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
  const file = resolveFile(pathname) ?? resolveFile('/')
  const size = statSync(file).size
  const type = types[extname(file)] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(file).pipe(res)
}).listen(port, '0.0.0.0', () => {
  console.log(`Landing preview on http://localhost:${port}`)
})
